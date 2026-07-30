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
