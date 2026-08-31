const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const qrcode = require('qrcode');
const express = require('express');
const os = require('os');
const { processMessageContent } = require('./src/linkProcessor');
require('dotenv').config();

const SECONDARY_TAG = process.env.SECONDARY_STORE_ID || 'techstor0caaf-21';
const SOURCE_IDS = (process.env.SOURCE_CHAT_ID || '').split(',').map(s => s.trim()).filter(Boolean);
const TARGET_ID = (process.env.TARGET_CHAT_ID || '').trim();
const AMAZON_DOMAIN = process.env.AMAZON_DOMAIN || 'amazon.in';
const CUELINKS_API_KEY = process.env.CUELINKS_API_KEY;
const CUELINKS_CHANNEL_ID = process.env.CUELINKS_CHANNEL_ID || 311305;
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const appLogs = [];
function addLog(message) {
    const time = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true });
    console.log(message);
    appLogs.push(`[${time} IST] ${message}`);
    if (appLogs.length > 100) appLogs.shift();
}

const botStats = { dealsConverted: 0, dealsScanned: 0, dealsSkipped: 0, startTime: Date.now() };

let authStatus = 'INITIALIZING';
let qrCodeData = null;
let pairingCode = null;
let requestPairingPhone = null;
let client = null;

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
            protocolTimeout: 0,
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

function startClient() {
    authStatus = 'INITIALIZING';
    qrCodeData = null;
    pairingCode = null;
    client = createClient();
    registerClientEvents();
    client.initialize();
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
        authStatus = 'READY';
        qrCodeData = null;
        pairingCode = null;
        addLog('WhatsApp Web Client is Ready!');
        addLog('Listening from: ' + (SOURCE_IDS.length > 0 ? SOURCE_IDS.join(', ') : 'ALL'));
        addLog('Forwarding to: ' + TARGET_ID);
    });

    client.on('disconnected', (reason) => {
        authStatus = 'DISCONNECTED';
        addLog('Client disconnected: ' + reason + '. Restarting in 10s...');
        setTimeout(() => { addLog('Restarting...'); startClient(); }, 10000);
    });

    const processedMessages = new Set();

    async function handleIncomingMessage(msg) {
        if (!msg || !msg.body || msg.fromMe) return;
        const msgId = msg.id && msg.id._serialized ? msg.id._serialized : (msg.from + '_' + msg.timestamp + '_' + msg.body.substring(0, 20));
        if (processedMessages.has(msgId)) return;
        processedMessages.add(msgId);
        if (processedMessages.size > 1000) processedMessages.delete(processedMessages.values().next().value);
        try {
            let chatName = 'Channel';
            try { const chat = await msg.getChat(); if (chat && chat.name) chatName = chat.name; } catch (_) {}
            const fromId = (msg.from || '').trim();
            const snippet = (msg.body || '').replace(/\s+/g, ' ').trim().substring(0, 70);
            addLog('[DEBUG] Received from "' + chatName + '" (' + fromId + '): "' + snippet + '..."');
            const isMatch = SOURCE_IDS.length === 0 || SOURCE_IDS.includes(fromId);
            if (!isMatch) return;
            botStats.dealsScanned++;
            addLog('New deal from "' + chatName + '"! Processing...');
            const modifiedText = await processMessageContent(msg.body, SECONDARY_TAG, AMAZON_DOMAIN, CUELINKS_API_KEY, CUELINKS_CHANNEL_ID);
            if (TARGET_ID && modifiedText && modifiedText.trim().length > 0) {
                await client.sendMessage(TARGET_ID, modifiedText);
                botStats.dealsConverted++;
                addLog('Deal forwarded successfully!');
            } else if (!TARGET_ID) {
                botStats.dealsSkipped++;
                addLog('TARGET_CHAT_ID missing in .env!');
            } else {
                botStats.dealsSkipped++;
                addLog('Message from "' + chatName + '" skipped - no meaningful content after cleanup.');
            }
        } catch (error) {
            addLog('Error: ' + error.message);
        }
    }

    client.on('message', handleIncomingMessage);
}

app.get('/api/logs', (req, res) => res.json(appLogs));

app.get('/api/stats', (req, res) => {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const procMem = process.memoryUsage().rss;
    const cpuCount = os.cpus().length;
    const loadAvg = os.loadavg()[0];
    const uptimeSec = Math.floor((Date.now() - botStats.startTime) / 1000);
    const h = Math.floor(uptimeSec / 3600);
    const m = Math.floor((uptimeSec % 3600) / 60);
    const s = uptimeSec % 60;
    res.json({
        ram: { used: Math.round(usedMem/1024/1024), total: Math.round(totalMem/1024/1024), proc: Math.round(procMem/1024/1024), pct: Math.round((usedMem/totalMem)*100) },
        cpu: { cores: cpuCount, load: loadAvg.toFixed(2) },
        uptime: h + 'h ' + m + 'm ' + s + 's',
        deals: { converted: botStats.dealsConverted, scanned: botStats.dealsScanned, skipped: botStats.dealsSkipped },
        status: authStatus
    });
});

app.get('/api/chats', async (req, res) => {
    try {
        if (!client || authStatus !== 'READY') return res.status(503).json({ status: authStatus, error: 'Not ready' });
        const chats = await client.getChats();
        res.json(chats.map(c => ({ id: c.id && c.id._serialized, name: c.name || 'Unnamed', isGroup: !!c.isGroup, isNewsletter: !!(c.id && c.id._serialized && c.id._serialized.endsWith('@newsletter')), unreadCount: c.unreadCount || 0 })));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/request-code', (req, res) => {
    if (req.body.phone) { requestPairingPhone = req.body.phone.replace(/[^0-9]/g, ''); client.resetState(); }
    res.redirect('/');
});

app.get('/', (req, res) => {
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
        'async function fetchLogs(){try{var logs=await(await fetch("/api/logs")).json();if(logs.length===lastCount)return;lastCount=logs.length;var c=document.getElementById("log-container");c.innerHTML="";if(logs.length===0){var p=document.createElement("p");p.textContent="Waiting...";c.appendChild(p);}else{logs.forEach(function(log){var p=document.createElement("p");p.textContent=log;c.appendChild(p);});c.scrollTop=c.scrollHeight;}}catch(e){}}' +
        'async function fetchStats(){try{var s=await(await fetch("/api/stats")).json();document.getElementById("ram-val").textContent=s.ram.used+" / "+s.ram.total+" MB";document.getElementById("ram-sub").textContent=s.ram.pct+"% used (Proc: "+s.ram.proc+" MB)";document.getElementById("ram-bar").style.width=s.ram.pct+"%";document.getElementById("cpu-cores").textContent=s.cpu.cores+" vCPU";document.getElementById("cpu-load").textContent="Load: "+s.cpu.load;document.getElementById("deals-conv").textContent=s.deals.converted;document.getElementById("deals-sub").textContent=s.deals.scanned+" scanned ("+s.deals.skipped+" skipped)";document.getElementById("uptime-val").textContent=s.uptime;}catch(e){}}' +
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
});

app.listen(PORT, '0.0.0.0', () => {
    console.log('Web Dashboard running on http://0.0.0.0:' + PORT);
    startClient();
});
