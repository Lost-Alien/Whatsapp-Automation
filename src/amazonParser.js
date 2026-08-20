const axios = require('axios');
const { convertCuelinks } = require('./cuelinksParser');

// Official TechSelect WhatsApp Channel Link
const TARGET_CHANNEL_LINK = 'https://whatsapp.com/channel/0029VbDdnbkG3R3e7wu0g70C';

function isAmazonUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const lower = url.toLowerCase();
    return (
        lower.includes('amazon.') ||
        lower.includes('amzn.to') ||
        lower.includes('amzn.eu') ||
        lower.includes('link.amazon') ||
        lower.includes('amzaff.to')
    );
}

async function expandShortUrl(rawUrl) {
    try {
        const response = await axios.get(rawUrl, {
            maxRedirects: 5,
            timeout: 8000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
            }
        });
        return response.request.res.responseUrl || rawUrl;
    } catch (err) {
        console.error(`⚠️ Error expanding link (${rawUrl}):`, err.message);
        return rawUrl;
    }
}

async function convertAmazonLink(rawUrl, newTag, amazonDomain) {
    let finalUrl = rawUrl;

    // Check if it's a known short url
    if (rawUrl.includes('amzn.to') || rawUrl.includes('amzn.eu') || rawUrl.includes('link.amazon') || rawUrl.includes('amzaff.to')) {
        finalUrl = await expandShortUrl(rawUrl);
    }

    // Skip if it already has our exact tag to prevent unnecessary processing/logging
    if (finalUrl.includes(`tag=${newTag}`)) {
        return finalUrl;
    }

    // Advanced regex to catch multiple formats: /dp/ASIN, /gp/product/ASIN, /gp/aw/d/ASIN
    const asinMatch = finalUrl.match(/\/(dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/i);

    if (asinMatch && asinMatch[2]) {
        const asin = asinMatch[2];
        return `https://www.${amazonDomain}/dp/${asin}?tag=${newTag}`;
    }

    // Fallback: direct tag parameter replacement if regex fails but tag exists
    if (finalUrl.includes('tag=')) {
        return finalUrl.replace(/tag=[^&]+/, `tag=${newTag}`);
    }

    // Ultimate fallback: append the tag if it doesn't exist at all
    const separator = finalUrl.includes('?') ? '&' : '?';
    return `${finalUrl}${separator}tag=${newTag}`;
}

function stripPromotionalContent(text) {
    if (!text || typeof text !== 'string') return '';

    let cleaned = text;

    // 1. Remove specific requirement headers like 'Req Jind', 'Req Tohana', or generic 'Req <City/Channel>'
    cleaned = cleaned.replace(/^\s*Req\s+.*$/gim, '');
    cleaned = cleaned.replace(/\bReq\s+(Jind|Tohana|[a-zA-Z0-9_-]+)\b/gi, '');

    // 2. Remove known promotional channel headers with or without emojis
    cleaned = cleaned.replace(/Only Mobile,?\s*TV Electronic Deals\s*[👇👉⬇️🔗]?/gi, '');
    cleaned = cleaned.replace(/All Loots,?\s*Mobile Deals & Rate update\s*[👇👉⬇️🔗]?/gi, '');
    cleaned = cleaned.replace(/(?:Join|Follow)\s+(?:our|the|this)?\s*(?:WhatsApp|Telegram|Channel|Group|Deals)[^\n]*/gi, '');

    // 3. Strip ANY WhatsApp channel and group links (any channel ID, with/without https/www/params)
    cleaned = cleaned.replace(/(?:https?:\/\/)?(?:www\.)?whatsapp\.com\/channel\/[a-zA-Z0-9_-]+(?:\?[^\s]*)?/gi, '');
    cleaned = cleaned.replace(/(?:https?:\/\/)?(?:www\.)?chat\.whatsapp\.com\/[a-zA-Z0-9_-]+(?:\?[^\s]*)?/gi, '');

    // 4. Remove Telegram channel/group URLs
    cleaned = cleaned.replace(/(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\/[a-zA-Z0-9_+.-]+(?:\?[^\s]*)?/gi, '');

    // 5. Remove generic redirect shortener URLs that redirect to promotional channels
    cleaned = cleaned.replace(/(?:https?:\/\/)?(?:www\.)?(?:tinyurl\.com|bit\.ly|cutt\.ly|is\.gd|t\.co|rb\.gy|shorturl\.at|buff\.ly|ow\.ly)\/[a-zA-Z0-9_-]+(?:\?[^\s]*)?/gi, '');

    // 6. Remove lines that only contain promotional lead labels left behind without URLs
    cleaned = cleaned.replace(/^\s*(?:Check\s+out|More\s+(?:loots?|deals?|offers?)|Join(?:\s+(?:other|our|the|this)?)?\s*(?:channel|group|now)?|Telegram|WhatsApp(?:\s+channel)?|Channel(?:\s+link)?|Follow(?:\s+us)?)\s*[:\-–—]?\s*$/gim, '');

    // 7. Clean up lines that only contain leftover emojis/punctuation (like 👇, 👉, ⬇️)
    cleaned = cleaned.replace(/^[\s👇👉⬇️🔗📌•\-–—*#:]+$/gm, '');

    // 8. Remove trailing pointer emojis at the end of lines
    cleaned = cleaned.replace(/[👇👉⬇️🔗]+\s*$/gm, '');

    // 9. Collapse multiple blank lines into max 2 newlines and trim
    cleaned = cleaned.replace(/\n\s*\n\s*\n+/g, '\n\n');
    cleaned = cleaned.trim();

    return cleaned;
}

async function processMessageContent(body, newTag, amazonDomain, cuelinksApiKey, cuelinksChannelId) {
    if (!body || typeof body !== 'string') return '';

    // First strip all unwanted promotional texts, ANY whatsapp channels, and redirects
    let updatedText = stripPromotionalContent(body);

    const effectiveCuelinksKey = cuelinksApiKey || process.env.CUELINKS_API_KEY;
    const effectiveChannelId = cuelinksChannelId || process.env.CUELINKS_CHANNEL_ID || 311305;

    // Find and convert all links in the remaining text
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const matches = updatedText.match(urlRegex);

    if (matches && matches.length > 0) {
        for (const link of matches) {
            if (isAmazonUrl(link)) {
                const convertedLink = await convertAmazonLink(link, newTag, amazonDomain);
                updatedText = updatedText.replace(link, convertedLink);
            } else if (effectiveCuelinksKey) {
                // Non-Amazon link: Convert via Cuelinks V3 API with TechSelect Channel ID (311305)
                const convertedLink = await convertCuelinks(link, effectiveCuelinksKey, effectiveChannelId);
                updatedText = updatedText.replace(link, convertedLink);
            }
        }
    }

    // Clean up trailing spaces and always append TechSelect channel link at the end
    updatedText = updatedText.trim();
    if (updatedText) {
        updatedText += `\n\n${TARGET_CHANNEL_LINK}`;
    }

    return updatedText;
}

module.exports = {
    TARGET_CHANNEL_LINK,
    isAmazonUrl,
    expandShortUrl,
    convertAmazonLink,
    convertCuelinks,
    stripPromotionalContent,
    processMessageContent
};
