const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const qrcode = require('qrcode');
const express = require('express');
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

let authStatus = 'INITIALIZING';
let qrCodeData = null;
let pairingCode = null;
let requestPairingPhone = null;
let client = null; // Will be initialized in startClient()

function createClient() {
    return new Client({
        authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
        authTimeoutMs: 120000,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
        webVersionCache: {
            type: 'none',
        },
        puppeteer: {
            headless: true,
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
            timeout: 120000,
            protocolTimeout: 0,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
                '--disable-extensions',
                '--disable-background-networking',
                '--disable-default-apps',
                '--disable-sync',
                '--disable-translate',
                '--hide-scrollbars',
                '--metrics-recording-only',
                '--mute-audio',
                '--safebrowsing-disable-auto-update',
                '--ignore-certificate-errors',
                '--ignore-ssl-errors',
                '--ignore-certificate-errors-spki-list'
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
    // Display QR Code for login or request pairing code
    client.on('qr', async (qr) => {
        authStatus = 'NEEDS_LOGIN';

        if (requestPairingPhone) {
            try {
                pairingCode = await client.requestPairingCode(requestPairingPhone);
                qrCodeData = null;
                console.log('\n=============================================================');
                console.log(`📱 Pairing Code requested! Enter this code on your phone:`);
                console.log(`                       ${pairingCode}`);
                console.log('=============================================================\n');
            } catch (e) {
                console.error("❌ Failed to request pairing code:", e.message);
                requestPairingPhone = null;
            }
        } else {
            qrCodeData = await qrcode.toDataURL(qr);
            pairingCode = null;
            console.log('\n================ Scan this QR Code on WhatsApp ================');
            qrcodeTerminal.generate(qr, { small: true });
        }
    });

    client.on('ready', () => {
        authStatus = 'READY';
        qrCodeData = null;
        pairingCode = null;
        addLog('✅ WhatsApp Web Client is Ready!');
        addLog(`Listening for messages from: ${SOURCE_IDS.length > 0 ? SOURCE_IDS.join(', ') : 'ALL CHANNELS'}`);
        addLog(`Forwarding updated deals to ID: "${TARGET_ID}"`);
    });

    client.on('disconnected', (reason) => {
        authStatus = 'DISCONNECTED';
        addLog(`⚠️  Client disconnected: ${reason}. Restarting in 10 seconds...`);
        // Auto-restart after 10 seconds
        setTimeout(() => {
            addLog('🔄 Restarting WhatsApp client...');
            startClient();
        }, 10000);
    });

    // Set to track processed messages and prevent duplicate triggers with zero rate limits
    const processedMessages = new Set();

    async function handleIncomingMessage(msg) {
        if (!msg || !msg.body) return;
        // Ignore messages sent by the bot itself to prevent forwarding loops
        if (msg.fromMe) return;
        const msgId = msg.id?._serialized || `${msg.from}_${msg.timestamp}_${msg.body.substring(0, 20)}`;

        if (processedMessages.has(msgId)) return;
        processedMessages.add(msgId);
        // Keep set bounded to latest 1000 messages
        if (processedMessages.size > 1000) {
            const firstEntry = processedMessages.values().next().value;
            processedMessages.delete(firstEntry);
        }

        try {
            let chatName = 'Channel';
            try {
                const chat = await msg.getChat();
                if (chat && chat.name) chatName = chat.name;
            } catch (e) {}

            const fromId = (msg.from || '').trim();
            const snippet = (msg.body || '').replace(/\s+/g, ' ').trim().substring(0, 70);
            addLog(`[DEBUG] Received from "${chatName}" (${fromId}): "${snippet}..."`);

            const isMatch = SOURCE_IDS.length === 0 || SOURCE_IDS.includes(fromId);

            if (isMatch) {
                addLog(`🔥 New deal detected from "${chatName}"! Processing links...`);
                const modifiedText = await processMessageContent(msg.body, SECONDARY_TAG, AMAZON_DOMAIN, CUELINKS_API_KEY, CUELINKS_CHANNEL_ID);

                if (TARGET_ID && modifiedText && modifiedText.trim().length > 0) {
                    await client.sendMessage(TARGET_ID, modifiedText);
                    addLog(`✅ Converted deal auto-posted to Target Channel successfully!`);
                } else if (!TARGET_ID) {
                    addLog(`❌ TARGET_CHAT_ID is missing in .env!`);
                } else {
                    addLog(`ℹ️ Message from "${chatName}" skipped (no valid store/card links found or only promo invites).`);
                }
            }
        } catch (error) {
            addLog(`❌ Error handling deal message: ${error.message}`);
        }
    }

    // Listen for incoming messages across both standard and broadcast events (zero limits)
    client.on('message', handleIncomingMessage);
    client.on('message_create', handleIncomingMessage);
}

// --- EXPRESS WEB SERVER ---
app.get('/', (req, res) => {
    let html = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>WhatsApp Bot Dashboard</title>
        <style>
            body { font-family: -apple-system, system-ui, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; text-align: center; margin-top: 50px; background-color: #f0f2f5; color: #1c1e21; }
            .card { background: white; padding: 40px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); display: inline-block; max-width: 600px; width: 100%; box-sizing: border-box; }
            h1 { color: #25D366; }
            .status { font-weight: bold; padding: 15px; border-radius: 6px; margin: 20px 0; }
            .status.ready { background: #d4edda; color: #155724; }
            .status.pending { background: #fff3cd; color: #856404; }
            input[type="text"] { padding: 12px; width: 80%; margin: 10px 0; border: 1px solid #ccc; border-radius: 6px; font-size: 16px; box-sizing: border-box; }
            button { background-color: #25D366; color: white; padding: 12px 24px; border: none; border-radius: 6px; cursor: pointer; font-size: 16px; font-weight: bold; width: 80%; transition: background 0.2s; }
            button:hover { background-color: #128C7E; }
            .code { font-size: 38px; letter-spacing: 6px; font-weight: bold; margin: 20px 0; color: #000; background: #eee; padding: 15px; border-radius: 8px; }
            a { color: #128C7E; text-decoration: none; font-weight: bold; }
            
            /* Log Viewer Styles */
            .terminal { background: #1e1e1e; color: #4af626; font-family: 'Courier New', Courier, monospace; font-size: 14px; text-align: left; padding: 15px; border-radius: 8px; height: 300px; overflow-y: auto; margin-top: 20px; box-shadow: inset 0 0 10px rgba(0,0,0,0.5); border: 1px solid #333; }
            .terminal p { margin: 4px 0; line-height: 1.4; word-wrap: break-word; }
        </style>
        ${authStatus !== 'READY' ? '<meta http-equiv="refresh" content="5">' : ''}
    </head>
    <body>
        <div class="card">
            <h1>🤖 WA Affiliate Bot</h1>
            <div style="font-size: 13px; color: #555; margin-bottom: 15px; font-weight: 500;">🕒 Server Time (IST): <span>${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'medium' })}</span></div>
    `;

    if (authStatus === 'READY') {
        html += `
            <div class="status ready">✅ Bot is securely logged in and running!</div>
            <h3>Live Activity Logs</h3>
            <div id="log-container" class="terminal">
                <p>Loading logs...</p>
            </div>
            <script>
                async function fetchLogs() {
                    try {
                        const response = await fetch('/api/logs');
                        const logs = await response.json();
                        const container = document.getElementById('log-container');
                        
                        if (logs.length === 0) {
                            container.innerHTML = '<p>Waiting for activity...</p>';
                        } else {
                            const html = logs.map(log => '<p>' + log + '</p>').join('');
                            if (container.innerHTML !== html) {
                                container.innerHTML = html;
                                container.scrollTop = container.scrollHeight;
                            }
                        }
                    } catch (e) {
                        console.error('Failed to fetch logs', e);
                    }
                }
                
                setInterval(fetchLogs, 2000);
                fetchLogs();
            </script>
        `;
    } else if (authStatus === 'INITIALIZING') {
        html += `<div class="status pending">⏳ Starting up WhatsApp Client...<br><small>Please wait a few seconds...</small></div>`;
    } else if (authStatus === 'DISCONNECTED') {
        html += `<div class="status pending">❌ Bot was disconnected. Please restart the server.</div>`;
    } else if (authStatus === 'NEEDS_LOGIN') {
        html += `<div class="status pending">🔐 Authentication Required</div>`;

        if (pairingCode) {
            html += `
                <p>Enter this Pairing Code on your phone:<br/>(Linked Devices > Link a Device > Link with phone number instead)</p>
                <div class="code">${pairingCode}</div>
                <p><a href="/">Refresh / Reset</a></p>
            `;
        } else if (qrCodeData) {
            html += `
                <p>Scan this QR Code with your WhatsApp app:</p>
                <img src="${qrCodeData}" alt="QR Code" style="width: 250px; height: 250px;" />
                <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;" />
                <p><strong>OR</strong></p>
                <p>Use a Phone Pairing Code instead:</p>
                <form action="/request-code" method="POST">
                    <input type="text" name="phone" placeholder="Enter number (e.g., 919876543210)" required />
                    <br>
                    <button type="submit">Get Pairing Code</button>
                </form>
            `;
        }
    }

    html += `
        </div>
    </body>
    </html>
    `;
    res.send(html);
});

app.get('/api/logs', (req, res) => {
    res.json(appLogs);
});

app.get('/api/chats', async (req, res) => {
    try {
        if (!client || authStatus !== 'READY') {
            return res.status(503).json({ status: authStatus, error: 'WhatsApp client is not ready yet' });
        }
        const chats = await client.getChats();
        const list = chats.map(c => ({
            id: c.id?._serialized,
            name: c.name || 'Unnamed',
            isGroup: !!c.isGroup,
            isNewsletter: !!(c.id?._serialized && c.id._serialized.endsWith('@newsletter')),
            unreadCount: c.unreadCount || 0
        }));
        res.json(list);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/request-code', (req, res) => {
    const phone = req.body.phone;
    if (phone) {
        requestPairingPhone = phone.replace(/[^0-9]/g, '');
        // Client needs to trigger QR event again to generate the code
        client.resetState();
    }
    res.redirect('/');
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌍 Web Dashboard is running on http://0.0.0.0:${PORT}`);
    startClient();
});
