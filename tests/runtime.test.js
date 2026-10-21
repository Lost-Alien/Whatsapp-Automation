const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { WorkQueue } = require('../src/workQueue');
const { mapSettled } = require('../src/concurrency');
const { createShutdown } = require('../src/shutdown');

let directory;
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-runtime-test-')); });
afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }); });
const queueFile = () => path.join(directory, 'queue.json');

test('failed sends survive restart and become delivered only after a successful retry', async () => {
    const worker = jest.fn().mockRejectedValue(new Error('offline'));
    const first = new WorkQueue({ file: queueFile(), processJob: worker, retryMs: 0 });
    first.enqueue({ id: 'message-1', body: 'deal' });
    first.running = true;
    await first.tick();
    first.stop();
    expect(first.state.pending).toHaveLength(1);
    expect(first.state.delivered['message-1']).toBeUndefined();
    const sent = jest.fn().mockResolvedValue(undefined);
    const second = new WorkQueue({ file: queueFile(), processJob: sent });
    second.running = true;
    await second.tick();
    second.stop();
    expect(sent).toHaveBeenCalledTimes(1);
    const restored = new WorkQueue({ file: queueFile(), processJob: sent });
    expect(restored.snapshot().pending).toBe(0);
    expect(restored.enqueue({ id: 'message-1', body: 'deal' })).toBe(false);
});

test('queue backpressure and duplicate IDs cannot start concurrent workers', async () => {
    let release;
    const worker = jest.fn(() => new Promise(resolve => { release = resolve; }));
    const queue = new WorkQueue({ file: queueFile(), processJob: worker, maxPending: 2 });
    queue.enqueue({ id: 'one', body: 'one' });
    expect(queue.enqueue({ id: 'one', body: 'duplicate' })).toBe(false);
    queue.enqueue({ id: 'two', body: 'two' });
    expect(() => queue.enqueue({ id: 'three', body: 'three' })).toThrow('queue full');
    queue.running = true;
    const active = queue.tick();
    await queue.tick();
    expect(worker).toHaveBeenCalledTimes(1);
    release();
    await active;
    queue.stop();
});

test('failed jobs are retained when retries are exhausted', async () => {
    const queue = new WorkQueue({ file: queueFile(), processJob: async () => { throw new Error('offline'); }, maxAttempts: 1 });
    queue.enqueue({ id: 'one', body: 'one' });
    queue.running = true;
    await queue.tick();
    queue.stop();
    expect(queue.snapshot()).toMatchObject({ pending: 1, failed: 1 });
    expect(JSON.parse(fs.readFileSync(queueFile())).pending[0].id).toBe('one');
});

test('link resolution stays bounded and retains individual failures', async () => {
    let active = 0, peak = 0;
    const result = await mapSettled([1, 2, 3, 4, 5], 2, async value => {
        active++; peak = Math.max(peak, active);
        await new Promise(resolve => setImmediate(resolve));
        active--;
        if (value === 3) throw new Error('bad link');
        return value * 2;
    });
    expect(peak).toBe(2);
    expect(result[2].status).toBe('rejected');
    expect(result[4]).toEqual({ status: 'fulfilled', value: 10 });
});

test('duplicate disconnects close one client and exit once', async () => {
    const destroy = jest.fn().mockResolvedValue(undefined);
    const stopWork = jest.fn();
    const exit = jest.fn();
    const shutdown = createShutdown({ getClient: () => ({ destroy, removeAllListeners() {} }), stopWork,
        closeServer: async () => {}, onStopping: () => {}, exit });
    await Promise.all([shutdown(1, 'disconnect'), shutdown(1, 'duplicate')]);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(stopWork).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
});

test('hung browser cleanup cannot hang shutdown indefinitely', async () => {
    jest.useFakeTimers();
    const exit = jest.fn();
    const shutdown = createShutdown({ getClient: () => ({ removeAllListeners() {}, destroy: () => new Promise(() => {}) }),
        stopWork() {}, closeServer: async () => {}, onStopping() {}, exit, timeoutMs: 500 });
    void shutdown(1, 'disconnect');
    jest.advanceTimersByTime(500);
    expect(exit).toHaveBeenCalledWith(1);
    jest.useRealTimers();
});
