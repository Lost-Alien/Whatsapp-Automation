const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { processMessageContent } = require('./src/amazonParser');
require('dotenv').config();

const SECONDARY_TAG = process.env.SECONDARY_STORE_ID || 'techstor0caaf-21';
const SOURCE_NAME = process.env.SOURCE_CHAT_NAME || 'The Mobile Magnet';
const TARGET_NAME = process.env.TARGET_CHAT_NAME;
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

// Display QR Code for login
client.on('qr', (qr) => {
    console.log('\n================ Scan this QR Code on WhatsApp ================');
    qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
    console.log('✅ WhatsApp Web Client is Ready!');
    console.log(`   Listening for messages from: "${SOURCE_NAME}"`);
    console.log(`   Forwarding updated deals to: "${TARGET_NAME}"`);

    // --- SAFE SIMULATED TEST ---
    try {
        console.log('\n--- Running Simulated Test ---');
        const allChats = await client.getChats();
        const targetChat = allChats.find(
            (c) => c.name && c.name.trim().toLowerCase() === TARGET_NAME.trim().toLowerCase()
        );

        if (targetChat) {
            console.log('Target chat found! Simulating a deal link swap...');
            
            // We use a simulated message instead of fetching from the channel to avoid the "r" crash.
            const fakeMessage = "🚨 HUGE DEAL! 🚨\nGrab this amazing smartphone now: https://amzn.to/3RGEFPV";
            const modifiedText = await processMessageContent(fakeMessage, SECONDARY_TAG, AMAZON_DOMAIN);
            
            await targetChat.sendMessage("🤖 [BOT TEST]\n" + modifiedText);
            console.log(`✅ Simulated test deal posted to "${TARGET_NAME}" successfully!`);
        } else {
            console.error(`❌ Target chat "${TARGET_NAME}" not found. Are you an admin?`);
        }
        console.log('------------------------------\n');
    } catch (err) {
        console.error('❌ Error during simulated test:', err.message);
    }
});

// Listen for incoming messages
client.on('message', async (msg) => {
    try {
        const chat = await msg.getChat();

        // Check if message is from your Source Channel/Group
        if (chat.name && chat.name.trim().toLowerCase() === SOURCE_NAME.trim().toLowerCase()) {
            console.log(`\n   New message detected in "${chat.name}"`);

            // Process text and replace affiliate links
            const modifiedText = await processMessageContent(msg.body, SECONDARY_TAG, AMAZON_DOMAIN);

            // Search for target destination chat
            const allChats = await client.getChats();
            const targetChat = allChats.find(
                (c) => c.name && c.name.trim().toLowerCase() === TARGET_NAME.trim().toLowerCase()
            );

            if (targetChat) {
                await targetChat.sendMessage(modifiedText);
                console.log(`   Converted deal auto-posted to "${TARGET_NAME}" successfully!`);
            } else {
                console.error(`❌ Target chat "${TARGET_NAME}" not found. Please check chat name in .env`);
            }
        }
    } catch (error) {
        console.error('❌ Error handling message:', error.message);
    }
});

client.initialize();
