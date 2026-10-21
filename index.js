const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const qrcode = require('qrcode');
const express = require('express');
const os = require('os');
const path = require('node:path');
const { timingSafeEqual } = require('node:crypto');
const { processMessageContent } = require('./src/linkProcessor');
const { WorkQueue } = require('./src/workQueue');
const { runtimeMemory } = require('./src/runtimeMemory');
const { createShutdown } = require('./src/shutdown');
require('dotenv').config();

const SECONDARY_TAG = process.env.SECONDARY_STORE_ID || 'techstor0caaf-21';
const SOURCE_IDS = (process.env.SOURCE_CHAT_ID || '').split(',').map(s => s.trim()).filter(Boolean);
const TARGET_ID = (process.env.TARGET_CHAT_ID || '').trim();
const AMAZON_DOMAIN = process.env.AMAZON_DOMAIN || 'amazon.in';
const CUELINKS_API_KEY = process.env.CUELINKS_API_KEY;
const CUELINKS_CHANNEL_ID = process.env.CUELINKS_CHANNEL_ID || 311305;
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.urlencoded({ extended: false, limit: '8kb' }));
app.use(express.json({ limit: '8kb' }));

function requireAdmin(req, res, next) {
    const address = req.socket.remoteAddress;
    if (['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)) return next();
    const expected = process.env.DASHBOARD_TOKEN || '';
    let supplied = req.get('X-Dashboard-Token') || '';
    const authorization = req.get('Authorization') || '';
    if (authorization.startsWith('Basic ')) {
        const decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
        supplied = decoded.slice(decoded.indexOf(':') + 1);
    }
    const suppliedBytes = Buffer.from(supplied);
    const expectedBytes = Buffer.from(expected);
    if (expected && suppliedBytes.length === expectedBytes.length && timingSafeEqual(suppliedBytes, expectedBytes)) return next();
    res.set('WWW-Authenticate', 'Basic realm="Bot administration"');
    return res.status(401).json({ error: 'Use an SSH tunnel or dashboard credentials for administration' });
}

const appLogs = [];
function addLog(message) {
    const time = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true });
    console.log(message);
    appLogs.push(`[${time} IST] ${message}`);
    if (appLogs.length > 100) appLogs.shift();
}

const botStats = { dealsConverted: 0, dealsScanned: 0, dealsSkipped: 0, queueRejected: 0, startTime: Date.now() };

let authStatus = 'INITIALIZING';
let qrCodeData = null;
let pairingCode = null;
let requestPairingPhone = null;
let client = null;
let server = null;
let stopping = false;

const queue = new WorkQueue({
    file: path.join(process.env.BOT_DATA_DIR || path.join(__dirname, '.data'), 'queue.json'),
    processJob: async job => {
        if (authStatus !== 'READY' || stopping) throw new Error('WhatsApp is not ready');
        let modifiedText = await processMessageContent(job.body, SECONDARY_TAG, AMAZON_DOMAIN, CUELINKS_API_KEY, CUELINKS_CHANNEL_ID);
        const hasFk = /(?:flipkart\.com|shopsy\.in|fkrt\.(?:it|co|in|cc|to|link|me)|fkr\.(?:in|co|cc|to|it)|bilty\.(?:co|in)|dl\.flipkart\.com)/i.test(job.body);
        if (hasFk && !modifiedText?.trim()) modifiedText = job.body.trim() + '\n\nhttps://whatsapp.com/channel/0029VbDdnbkG3R3e7wu0g70C';
        if (!modifiedText?.trim()) { botStats.dealsSkipped++; return; }
        if (!TARGET_ID) throw new Error('TARGET_CHAT_ID is not configured');
        await client.sendMessage(TARGET_ID, modifiedText);
        botStats.dealsConverted++;
        addLog('Deal forwarded successfully!');
    },
    onError: error => addLog('Queued deal error: ' + error.message),
});

const shutdown = createShutdown({
    getClient: () => client,
    stopWork: () => queue.stop(),
    closeServer: () => new Promise(resolve => server ? server.close(resolve) : resolve()),
    onStopping: reason => { stopping = true; authStatus = 'DISCONNECTED'; addLog('Stopping client: ' + reason); },
});
process.once('SIGTERM', () => shutdown(0, 'service stop'));
process.once('SIGINT', () => shutdown(0, 'service stop'));
process.on('unhandledRejection', error => shutdown(1, 'Unhandled operation: ' + (error?.message || String(error))));
process.on('uncaughtException', error => shutdown(1, 'Unexpected error: ' + error.message));

function createClient() {
    return new Client({
        authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
        authTimeoutMs: 120000,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
        webVersionCache: { type: 'none' },
        puppeteer: {
            headless: true,
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
            timeout: 120000,
            protocolTimeout: 60000,
            args: [
                '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas', '--no-first-run', '--no-zygote',
                '--disable-gpu', '--disable-extensions', '--disable-background-networking',
                '--disable-default-apps', '--disable-sync', '--disable-translate',
                '--hide-scrollbars', '--metrics-recording-only', '--mute-audio',
                '--safebrowsing-disable-auto-update', '--ignore-certificate-errors',
                '--ignore-ssl-errors', '--ignore-certificate-errors-spki-list'
            ]
        }
    });
}

async function startClient() {
    authStatus = 'INITIALIZING';
    qrCodeData = null;
    pairingCode = null;
    client = createClient();
    registerClientEvents();
    const deadline = setTimeout(() => {
        if (authStatus === 'INITIALIZING') shutdown(1, 'Client initialization deadline exceeded');
    }, 180000);
    deadline.unref();
    try {
        await client.initialize();
        client.pupBrowser?.once('disconnected', () => shutdown(1, 'Browser disconnected'));
    }
    finally { clearTimeout(deadline); }
}

function registerClientEvents() {
    client.on('qr', async (qr) => {
        authStatus = 'NEEDS_LOGIN';
        if (requestPairingPhone) {
            try {
                pairingCode = await client.requestPairingCode(requestPairingPhone);
                qrCodeData = null;
                console.log('\n=============================================================');
                console.log('Pairing Code: ' + pairingCode);
                console.log('=============================================================\n');
            } catch (e) {
                console.error('Failed to request pairing code:', e.message);
                requestPairingPhone = null;
            }
        } else {
            qrCodeData = await qrcode.toDataURL(qr);
            pairingCode = null;
            qrcodeTerminal.generate(qr, { small: true });
        }
    });

    client.on('ready', () => {
        if (stopping) return;
        authStatus = 'READY';
        qrCodeData = null;
        pairingCode = null;
        addLog('WhatsApp Web Client is Ready!');
        addLog('Listening from: ' + (SOURCE_IDS.length > 0 ? SOURCE_IDS.join(', ') : 'ALL'));
        addLog('Forwarding to: ' + TARGET_ID);
        queue.start();
        // This bot forwards text only; avoid background media download/cache growth.
        for (const method of ['setAutoDownloadPhotos', 'setAutoDownloadVideos', 'setAutoDownloadAudio', 'setAutoDownloadDocuments']) {
            if (typeof client[method] === 'function') client[method](false).catch(error => addLog('Media preference: ' + error.message));
        }
    });

    client.on('disconnected', (reason) => {
        shutdown(1, 'Client disconnected: ' + reason);
    });

    function handleIncomingMessage(msg) {
        if (!msg || !msg.body || msg.fromMe) return;
        const fromId = (msg.from || '').trim();
        if (fromId === TARGET_ID || (SOURCE_IDS.length && !SOURCE_IDS.includes(fromId))) return;
        const msgId = msg.id && msg.id._serialized ? msg.id._serialized : (msg.from + '_' + msg.timestamp + '_' + msg.body.substring(0, 20));
        try {
            if (queue.enqueue({ id: msgId, from: fromId, body: msg.body })) botStats.dealsScanned++;
        } catch (error) {
            botStats.queueRejected++;
            addLog('Message was not queued: ' + error.message);
        }
    }

    client.on('message', handleIncomingMessage);
}

app.get('/api/logs', requireAdmin, (req, res) => res.json(appLogs));

app.get('/healthz', (req, res) => {
    const pending = queue.snapshot();
    const healthy = authStatus === 'READY' && !stopping && !pending.failed && !pending.error;
    res.status(healthy ? 200 : 503).json({ status: authStatus, queue: pending });
});

app.post('/api/queue/retry', requireAdmin, (req, res) => {
    try { queue.retryFailed(); res.json(queue.snapshot()); }
    catch (_) { res.status(503).json({ error: 'Could not save retry state' }); }
});

app.get('/api/stats', (req, res) => {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const procMem = process.memoryUsage().rss;
    const memory = runtimeMemory();
    const actualUsed = memory.available === undefined ? usedMem / 1048576 : totalMem / 1048576 - memory.available;
    const cpuCount = os.cpus().length;
    const loadAvg = os.loadavg()[0];
    const uptimeSec = Math.floor((Date.now() - botStats.startTime) / 1000);
    const h = Math.floor(uptimeSec / 3600);
    const m = Math.floor((uptimeSec % 3600) / 60);
    const s = uptimeSec % 60;
    res.json({
        ram: { used: Math.round(actualUsed), total: Math.round(totalMem/1048576), proc: Math.round(procMem/1048576), pct: Math.round(actualUsed/(totalMem/1048576)*100), ...memory },
        cpu: { cores: cpuCount, load: loadAvg.toFixed(2) },
        uptime: h + 'h ' + m + 'm ' + s + 's',
        deals: { converted: botStats.dealsConverted, scanned: botStats.dealsScanned, skipped: botStats.dealsSkipped },
        status: authStatus,
        queue: queue.snapshot()
    });
});

app.get('/api/chats', requireAdmin, async (req, res) => {
    try {
        if (!client || authStatus !== 'READY') return res.status(503).json({ status: authStatus, error: 'Not ready' });
        const chats = await client.getChats();
        res.json(chats.map(c => ({ id: c.id && c.id._serialized, name: c.name || 'Unnamed', isGroup: !!c.isGroup, isNewsletter: !!(c.id && c.id._serialized && c.id._serialized.endsWith('@newsletter')), unreadCount: c.unreadCount || 0 })));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/request-code', requireAdmin, async (req, res) => {
    if (authStatus !== 'NEEDS_LOGIN') return res.status(409).json({ error: 'Pairing is only available when login is required' });
    if (req.body.phone) {
        requestPairingPhone = req.body.phone.replace(/[^0-9]/g, '');
        try { await client.resetState(); } catch (_) { return res.status(503).json({ error: 'Pairing is temporarily unavailable' }); }
    }
    res.redirect('/');
});

app.get('/', (req, res) => {
    if (authStatus === 'NEEDS_LOGIN') return requireAdmin(req, res, () => renderDashboard(req, res));
    return renderDashboard(req, res);
});

function renderDashboard(req, res) {
    const istTime = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'medium' });
    const autoRefresh = authStatus !== 'READY' ? '<meta http-equiv="refresh" content="5">' : '';
    let body = '';
    if (authStatus === 'READY') {
        body = '<div class="status ready">Bot is logged in and running!</div>' +
        '<div class="stats-grid">' +
        '<div class="stat-box"><div class="label">Server RAM</div><div class="value" id="ram-val">-</div><div class="sub" id="ram-sub">Loading...</div><div class="progress"><div class="progress-bar" id="ram-bar" style="width:0%"></div></div></div>' +
        '<div class="stat-box"><div class="label">CPU and Cores</div><div class="value" id="cpu-cores">-</div><div class="sub" id="cpu-load">Load: -</div></div>' +
        '<div class="stat-box"><div class="label">Deals Converted</div><div class="value" id="deals-conv">-</div><div class="sub" id="deals-sub">- scanned (- skipped)</div></div>' +
        '<div class="stat-box"><div class="label">Server Uptime</div><div class="value" id="uptime-val">-</div><div class="sub">Status: READY</div></div>' +
        '</div>' +
        '<h3>Live Activity Logs</h3>' +
        '<div id="log-container" class="terminal"><p>Loading logs...</p></div>' +
        '<script>' +
        'function updateClock(){document.getElementById("ist-clock").textContent=new Date().toLocaleString("en-IN",{timeZone:"Asia/Kolkata",dateStyle:"medium",timeStyle:"medium"});}' +
        'setInterval(updateClock,1000);' +
        'var lastCount=0;' +
        'async function fetchLogs(){try{var r=await fetch("/api/logs");var c=document.getElementById("log-container");if(r.status===401){c.textContent="Private logs are available over an SSH tunnel or with dashboard credentials.";return;}var logs=await r.json();if(logs.length===lastCount)return;lastCount=logs.length;c.innerHTML="";if(logs.length===0){var p=document.createElement("p");p.textContent="Waiting...";c.appendChild(p);}else{logs.forEach(function(log){var p=document.createElement("p");p.textContent=log;c.appendChild(p);});c.scrollTop=c.scrollHeight;}}catch(e){}}' +
        'async function fetchStats(){try{var s=await(await fetch("/api/stats")).json();document.getElementById("ram-val").textContent=s.ram.used+" / "+s.ram.total+" MB";document.getElementById("ram-sub").textContent=s.ram.pct+"% used; bot + Chrome: "+(s.ram.service==null?s.ram.proc:s.ram.service)+" MB; swap: "+(s.ram.swap||0)+" MB";document.getElementById("ram-bar").style.width=s.ram.pct+"%";document.getElementById("cpu-cores").textContent=s.cpu.cores+" vCPU";document.getElementById("cpu-load").textContent="Load: "+s.cpu.load;document.getElementById("deals-conv").textContent=s.deals.converted;document.getElementById("deals-sub").textContent=s.deals.scanned+" scanned ("+s.deals.skipped+" skipped), "+s.queue.pending+" queued, "+s.queue.failed+" failed";document.getElementById("uptime-val").textContent=s.uptime;}catch(e){}}' +
        'setInterval(fetchLogs,2000);setInterval(fetchStats,3000);fetchLogs();fetchStats();' +
        '<\/script>';
    } else if (authStatus === 'INITIALIZING') {
        body = '<div class="status pending">Starting up WhatsApp Client... Please wait.</div>';
    } else if (authStatus === 'DISCONNECTED') {
        body = '<div class="status error">Bot disconnected. Auto-restarting in 10 seconds...</div>';
    } else if (authStatus === 'NEEDS_LOGIN') {
        body = '<div class="status pending">Authentication Required</div>';
        if (pairingCode) {
            body += '<p>Enter this Pairing Code on your phone:</p><div class="code">' + pairingCode + '</div><p><a href="/">Refresh</a></p>';
        } else if (qrCodeData) {
            body += '<p>Scan QR Code with WhatsApp:</p><img src="' + qrCodeData + '" alt="QR" style="width:250px;height:250px;margin:12px 0"/><hr><p>OR use Phone Pairing Code:</p><form action="/request-code" method="POST"><input type="text" name="phone" placeholder="e.g. 919876543210" required/><br><button type="submit">Get Pairing Code</button></form>';
        }
    }
    res.send('<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WA Affiliate Bot</title>' + autoRefresh + '<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;background:#f0f2f5;color:#1c1e21;min-height:100vh;padding:30px 16px}.card{background:#fff;padding:32px;border-radius:16px;box-shadow:0 4px 16px rgba(0,0,0,.1);max-width:640px;width:100%;margin:0 auto}h1{color:#25D366;font-size:1.6rem;margin-bottom:4px}.time{font-size:13px;color:#666;margin-bottom:20px}.status{font-weight:600;padding:12px 16px;border-radius:8px;margin-bottom:20px;font-size:15px}.status.ready{background:#d4edda;color:#155724}.status.pending{background:#fff3cd;color:#856404}.status.error{background:#f8d7da;color:#721c24}.stats-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px}.stat-box{background:#f8f9fa;border-radius:10px;padding:14px 16px;text-align:left}.stat-box .label{font-size:12px;color:#888;font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px}.stat-box .value{font-size:20px;font-weight:700;color:#1c1e21}.stat-box .sub{font-size:12px;color:#666;margin-top:2px}.progress{background:#e9ecef;border-radius:4px;height:6px;margin-top:6px}.progress-bar{background:#25D366;border-radius:4px;height:6px;transition:width .5s}h3{font-size:14px;font-weight:600;color:#444;margin-bottom:8px}.terminal{background:#1a1a2e;color:#00d4aa;font-family:"Courier New",monospace;font-size:13px;text-align:left;padding:14px;border-radius:10px;height:320px;overflow-y:auto;border:1px solid #2a2a4a}.terminal p{margin:3px 0;line-height:1.5;word-break:break-word}input[type="text"]{padding:11px 14px;width:80%;margin:10px 0;border:1px solid #ddd;border-radius:8px;font-size:15px}button{background:#25D366;color:#fff;padding:12px 24px;border:none;border-radius:8px;cursor:pointer;font-size:15px;font-weight:600;width:80%;transition:background .2s}button:hover{background:#128C7E}.code{font-size:36px;letter-spacing:8px;font-weight:700;margin:16px 0;background:#f0f2f5;padding:14px;border-radius:10px;color:#000}a{color:#128C7E;text-decoration:none;font-weight:600}hr{border:none;border-top:1px solid #eee;margin:24px 0}</style></head><body><div class="card"><h1>WA Affiliate Bot</h1><div class="time">Server Time (IST): <span id="ist-clock">' + istTime + '</span></div>' + body + '</div></body></html>');
}

server = app.listen(PORT, process.env.DASHBOARD_HOST || '0.0.0.0', () => {
    console.log('Web Dashboard running on http://0.0.0.0:' + PORT);
    startClient().catch(error => shutdown(1, 'Initialization failed: ' + error.message));
});
