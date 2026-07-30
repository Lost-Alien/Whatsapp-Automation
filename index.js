const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const qrcode = require('qrcode');
const express = require('express');
const { processMessageContent } = require('./src/amazonParser');
require('dotenv').config();

const SECONDARY_TAG = process.env.SECONDARY_STORE_ID || 'techstor0caaf-21';
const SOURCE_ID = process.env.SOURCE_CHAT_ID;
const TARGET_ID = process.env.TARGET_CHAT_ID;
const AMAZON_DOMAIN = process.env.AMAZON_DOMAIN || 'amazon.in';
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.urlencoded({ extended: true }));

let authStatus = 'INITIALIZING';
let qrCodeData = null;
let pairingCode = null;
let requestPairingPhone = null;

// Initialize WhatsApp Web Client
const client = new Client({
    authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
    puppeteer: {
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ]
    }
});

// Display QR Code for login or request pairing code
client.on('qr', async (qr) => {
    authStatus = 'NEEDS_LOGIN';
    
    if (requestPairingPhone) {
        try {
            pairingCode = await client.requestPairingCode(requestPairingPhone);
            qrCodeData = null; // Clear QR code
            console.log('\n=============================================================');
            console.log(`📱 Pairing Code requested! Enter this code on your phone:`);
            console.log(`                       ${pairingCode}`);
            console.log('=============================================================\n');
        } catch(e) {
            console.error("❌ Failed to request pairing code:", e.message);
            requestPairingPhone = null;
        }
    } else {
        // Generate QR Code data URL for Web UI
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
    console.log('✅ WhatsApp Web Client is Ready!');
    console.log(`   Listening for messages from ID: "${SOURCE_ID}"`);
    console.log(`   Forwarding updated deals to ID: "${TARGET_ID}"`);
    console.log(`\n🌍 Web Dashboard running at: http://localhost:${PORT}\n`);
});

client.on('disconnected', (reason) => {
    authStatus = 'DISCONNECTED';
    console.log('❌ Client was logged out', reason);
});

// Listen for incoming messages
client.on('message', async (msg) => {
    try {
        console.log(`[DEBUG] Received a message from ID: ${msg.from}`);

        if (SOURCE_ID && msg.from === SOURCE_ID.trim()) {
            console.log(`\n   New deal detected in Source Channel!`);
            const modifiedText = await processMessageContent(msg.body, SECONDARY_TAG, AMAZON_DOMAIN);

            if (TARGET_ID) {
                await client.sendMessage(TARGET_ID.trim(), modifiedText);
                console.log(`   ✅ Converted deal auto-posted to Target Channel successfully!`);
            } else {
                console.error(`❌ TARGET_CHAT_ID is missing in .env!`);
            }
        }
    } catch (error) {
        console.error('❌ Error handling message:', error.stack || error);
    }
});

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
            .card { background: white; padding: 40px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); display: inline-block; max-width: 500px; width: 100%; box-sizing: border-box; }
            h1 { color: #25D366; }
            .status { font-weight: bold; padding: 15px; border-radius: 6px; margin: 20px 0; }
            .status.ready { background: #d4edda; color: #155724; }
            .status.pending { background: #fff3cd; color: #856404; }
            input[type="text"] { padding: 12px; width: 80%; margin: 10px 0; border: 1px solid #ccc; border-radius: 6px; font-size: 16px; box-sizing: border-box; }
            button { background-color: #25D366; color: white; padding: 12px 24px; border: none; border-radius: 6px; cursor: pointer; font-size: 16px; font-weight: bold; width: 80%; transition: background 0.2s; }
            button:hover { background-color: #128C7E; }
            .code { font-size: 38px; letter-spacing: 6px; font-weight: bold; margin: 20px 0; color: #000; background: #eee; padding: 15px; border-radius: 8px; }
            a { color: #128C7E; text-decoration: none; font-weight: bold; }
        </style>
        ${authStatus !== 'READY' ? '<meta http-equiv="refresh" content="5">' : ''}
    </head>
    <body>
        <div class="card">
            <h1>🤖 WA Affiliate Bot</h1>
    `;

    if (authStatus === 'READY') {
        html += `<div class="status ready">✅ Bot is securely logged in and running!</div>`;
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

app.post('/request-code', (req, res) => {
    const phone = req.body.phone;
    if (phone) {
        requestPairingPhone = phone.replace(/[^0-9]/g, '');
        // Client needs to trigger QR event again to generate the code
        client.resetState();
    }
    res.redirect('/');
});

app.listen(PORT, () => {
    console.log(`🌍 Web Dashboard is running on port ${PORT}`);
    client.initialize();
});
