const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { processMessageContent } = require('./src/amazonParser');
const readline = require('readline');
require('dotenv').config();

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

let usePairingCode = false;
let userPhoneNumber = '';

const SECONDARY_TAG = process.env.SECONDARY_STORE_ID || 'techstor0caaf-21';
const SOURCE_ID = process.env.SOURCE_CHAT_ID; // e.g., 12036319323123@newsletter
const TARGET_ID = process.env.TARGET_CHAT_ID; // e.g., 12036319323124@newsletter
const AMAZON_DOMAIN = process.env.AMAZON_DOMAIN || 'amazon.in';

// Initialize WhatsApp Web Client
const client = new Client({
    authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
    puppeteer: {
        headless: true,
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
    if (usePairingCode) {
        try {
            const code = await client.requestPairingCode(userPhoneNumber);
            console.log('\n=============================================================');
            console.log(`📱 Pairing Code requested! Enter this code on your phone:`);
            console.log(`                       ${code}`);
            console.log('=============================================================\n');
        } catch(e) {
            console.error("❌ Failed to request pairing code:", e.message);
        }
    } else {
        console.log('\n================ Scan this QR Code on WhatsApp ================');
        qrcode.generate(qr, { small: true });
    }
});

client.on('ready', async () => {
    console.log('✅ WhatsApp Web Client is Ready!');
    console.log(`   Listening for messages from ID: "${SOURCE_ID}"`);
    console.log(`   Forwarding updated deals to ID: "${TARGET_ID}"`);
    console.log('\n💡 TIP: If you do not know your Channel IDs, just send a message in them and watch this terminal!\n');
});

// Listen for incoming messages
client.on('message', async (msg) => {
    try {
        // ALWAYS log the incoming ID so the user can discover their channel IDs easily
        console.log(`[DEBUG] Received a message from ID: ${msg.from}`);

        // Check if message is from your Source Channel ID
        if (SOURCE_ID && msg.from === SOURCE_ID.trim()) {
            console.log(`\n   New deal detected in Source Channel!`);

            // Process text and replace affiliate links
            const modifiedText = await processMessageContent(msg.body, SECONDARY_TAG, AMAZON_DOMAIN);

            if (TARGET_ID) {
                // Send directly to the target ID, bypassing getChat() entirely!
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

// Prompt for authentication method before initializing
rl.question('\nDo you want to use a phone Pairing Code? \nIf yes, enter your phone number with country code (e.g. 919876543210). \nIf no, just press Enter to use a QR Code: ', (answer) => {
    const cleanAnswer = answer.replace(/[^0-9]/g, '');
    
    if (cleanAnswer.length > 5) {
        usePairingCode = true;
        userPhoneNumber = cleanAnswer;
        console.log(`\nStarting bot and requesting pairing code for +${userPhoneNumber}...`);
    } else {
        console.log('\nStarting bot with QR Code authentication...');
    }
    
    rl.close();
    client.initialize();
});
