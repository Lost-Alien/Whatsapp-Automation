const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

function loadApp(env = {}) {
    const routes = new Map();
    const clients = [];
    const shutdown = jest.fn();
    class Client extends EventEmitter {
        constructor() { super(); clients.push(this); this.resetState = jest.fn(); }
        initialize() { return Promise.resolve(); }
    }
    class Queue {
        start() {} stop() {} retryFailed() {} enqueue() { return true; }
        snapshot() { return { pending: 0, failed: 0 }; }
    }
    const app = { use() {}, get(route, ...handlers) { routes.set('GET ' + route, handlers); },
        post(route, ...handlers) { routes.set('POST ' + route, handlers); },
        listen(port, host, callback) { callback(); return { close(callback) { callback(); } }; } };
    const express = () => app;
    express.urlencoded = express.json = () => () => {};
    const context = {
        require(name) {
            if (name === 'whatsapp-web.js') return { Client, LocalAuth: class {} };
            if (name === 'express') return express;
            if (name === 'dotenv') return { config() {} };
            if (name === './src/workQueue') return { WorkQueue: Queue };
            if (name === './src/shutdown') return { createShutdown: () => shutdown };
            if (name === './src/runtimeMemory') return { runtimeMemory: () => ({}) };
            if (name === './src/linkProcessor') return { processMessageContent: async () => '' };
            if (name === 'qrcode' || name === 'qrcode-terminal') return {};
            return require(name);
        },
        process: { env, once() {}, on() {} }, __dirname: directory(), Buffer,
        console: { log() {}, error() {} },
        setTimeout: () => ({ unref() {} }), clearTimeout() {},
    };
    vm.runInNewContext(fs.readFileSync(require.resolve('../index.js'), 'utf8'), context);
    return { routes, client: clients[0], shutdown };
}
function directory() { return require('node:path').dirname(require.resolve('../index.js')); }
function response() {
    const res = { code: 200, status(code) { this.code = code; return this; },
        set() { return this; }, json(body) { this.body = body; return this; } };
    return res;
}

test('remote callers cannot reset pairing or read chat lists without credentials', () => {
    const { routes } = loadApp();
    for (const route of ['POST /request-code', 'GET /api/chats', 'GET /api/logs', 'POST /api/queue/retry']) {
        const res = response(), next = jest.fn();
        routes.get(route)[0]({ socket: { remoteAddress: '203.0.113.5' }, get: () => '' }, res, next);
        expect(res.code).toBe(401);
        expect(next).not.toHaveBeenCalled();
    }
});

test('token byte-length differences are rejected without an exception', () => {
    const { routes } = loadApp({ DASHBOARD_TOKEN: 'x' });
    const res = response();
    routes.get('POST /request-code')[0]({ socket: { remoteAddress: '203.0.113.5' }, get: () => 'é' }, res, jest.fn());
    expect(res.code).toBe(401);
});

test('a ready bot cannot be reset even by an administrator', async () => {
    const { routes, client } = loadApp();
    client.emit('ready');
    const res = response();
    await routes.get('POST /request-code')[1]({ body: { phone: '123' } }, res);
    expect(res.code).toBe(409);
    expect(client.resetState).not.toHaveBeenCalled();
});

test('disconnects go to the supervisor instead of starting another browser', () => {
    const { client, shutdown } = loadApp();
    client.emit('disconnected', 'test');
    expect(shutdown).toHaveBeenCalledWith(1, 'Client disconnected: test');
});
