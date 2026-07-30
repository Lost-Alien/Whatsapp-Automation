const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
require('dotenv').config();

const SECONDARY_TAG = process.env.SECONDARY_STORE_ID || 'techstor0caaf-21';
const SOURCE_NAME = process.env.SOURCE_CHAT_NAME || 'The Mobile Magnet';
const TARGET_NAME = process.env.TARGET_CHAT_NAME;

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

/**
 * Resolves shortened URLs and extracts Amazon ASIN to rebuild affiliate links
 */
async function convertAmazonLink(rawUrl, newTag) {
    try {
        // Send a HEAD/GET request to expand redirects
        const response = await axios.get(rawUrl, {
            maxRedirects: 5,
            timeout: 8000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
            }
        });

        const finalUrl = response.request.res.responseUrl || rawUrl;

        // Match Amazon Product ASIN (e.g. B0H1WVW8VY)
        const asinMatch = finalUrl.match(/\/(dp|gp\/product)\/([A-Z0-9]{10})/i);

        if (asinMatch && asinMatch[2]) {
            const asin = asinMatch[2];
            return `https://www.amazon.in/dp/${asin}?tag=${newTag}`;
        }

        // Fallback: direct tag parameter replacement
        if (finalUrl.includes('tag=')) {
            return finalUrl.replace(/tag=[^&]+/, `tag=${newTag}`);
        }

        return finalUrl;
    } catch (err) {
        console.error(`⚠️ Error expanding link (${rawUrl}):`, err.message);
        return rawUrl;
    }
}

/**
 * Parses message text and replaces all Amazon links with new store ID
 */
async function processMessageContent(body) {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const matches = body.match(urlRegex);

    if (!matches || matches.length === 0) return body;

    let updatedText = body;

    for (const link of matches) {
        // Check for common Amazon domains and shorteners
        if (
            link.includes('amazon') ||
            link.includes('amzn.to') ||
            link.includes('link.amazon') ||
            link.includes('amzaff.to')
        ) {
            const convertedLink = await convertAmazonLink(link, SECONDARY_TAG);
            updatedText = updatedText.replace(link, convertedLink);
        }
    }

    return updatedText;
}

// Listen for incoming messages
client.on('message', async (msg) => {
    try {
        const chat = await msg.getChat();

        // Check if message is from your Source Channel/Group
        if (chat.name && chat.name.trim().toLowerCase() === SOURCE_NAME.trim().toLowerCase()) {
            console.log(`\n   New message detected in "${chat.name}"`);

            // Process text and replace affiliate links
            const modifiedText = await processMessageContent(msg.body);

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
