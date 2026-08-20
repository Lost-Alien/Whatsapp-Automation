const axios = require('axios');
const { convertCuelinks } = require('./cuelinksParser');

// Target TechSelect WhatsApp Channel Link
const TARGET_CHANNEL_LINK = 'https://whatsapp.com/channel/0029VbDdnbkG3R3e7wu0g70C';

/**
 * Checks if a given URL is an Amazon product or short link.
 * @param {string} rawUrl 
 * @returns {boolean}
 */
function isAmazonUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return false;
    const lower = rawUrl.toLowerCase();
    return (
        lower.includes('amazon.in') ||
        lower.includes('amazon.com') ||
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
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        return response.request?.res?.responseUrl || rawUrl;
    } catch (err) {
        console.error(`⚠️ Error expanding link (${rawUrl}):`, err.message);
        return rawUrl;
    }
}

async function convertAmazonLink(rawUrl, newTag, amazonDomain = 'amazon.in') {
    if (!rawUrl) return rawUrl;

    let finalUrl = rawUrl;

    // Check if it is a shortened Amazon URL
    const lowerUrl = rawUrl.toLowerCase();
    if (
        lowerUrl.includes('amzn.to') || 
        lowerUrl.includes('amzn.eu') || 
        lowerUrl.includes('link.amazon') || 
        lowerUrl.includes('amzaff.to')
    ) {
        finalUrl = await expandShortUrl(rawUrl);
    }

    // Extract ASIN (10 alphanumeric characters) from typical Amazon URL patterns
    const asinMatch = finalUrl.match(/(?:\/dp\/|\/gp\/product\/|\/gp\/aw\/d\/|(?:\?|&)asin=)([a-zA-Z0-9]{10})/i);
    if (asinMatch && asinMatch[1]) {
        const asin = asinMatch[1];
        return `https://www.${amazonDomain}/dp/${asin}?tag=${newTag}`;
    }

    // If tag already exists on standard URL, replace it
    if (finalUrl.includes('tag=')) {
        return finalUrl.replace(/tag=[a-zA-Z0-9._-]+/g, `tag=${newTag}`);
    }

    // Fallback: append the tag
    const separator = finalUrl.includes('?') ? '&' : '?';
    return `${finalUrl}${separator}tag=${newTag}`;
}

function stripPromotionalContent(text) {
    if (!text || typeof text !== 'string') return '';

    let cleaned = text;

    // 1. Remove specific requirement headers like 'Req Jind', 'Req Tohana', 'Req Sumit Bhiwani', etc.
    cleaned = cleaned.replace(/^\s*Req\s+.*$/gim, '');
    cleaned = cleaned.replace(/\bReq\s+[a-zA-Z0-9_\s-]+\b/gi, '');

    // 2. Remove known promotional channel headers with or without emojis
    cleaned = cleaned.replace(/Only Mobile,?\s*TV Electronic Deals\s*[👇👉⬇️🔗]?/gi, '');
    cleaned = cleaned.replace(/All Loots,?\s*Mobile Deals & Rate update\s*[👇👉⬇️🔗]?/gi, '');
    cleaned = cleaned.replace(/(?:Join|Follow)\s+(?:our|the|this)?\s*(?:WhatsApp|Telegram|Channel|Group|Deals)[^\n]*/gi, '');

    // 3. Strip ANY foreign WhatsApp channel and group links (any channel ID, with/without https/www/params)
    cleaned = cleaned.replace(/[<(\[]?(?:https?:\/\/)?(?:www\.)?whatsapp\.com\/channel\/[a-zA-Z0-9_-]+(?:\?[^\s>\])]*)?[>)\]]?/gi, '');
    cleaned = cleaned.replace(/[<(\[]?(?:https?:\/\/)?(?:www\.)?chat\.whatsapp\.com\/[a-zA-Z0-9_-]+(?:\?[^\s>\])]*)?[>)\]]?/gi, '');

    // 4. Remove Telegram channel/group URLs
    cleaned = cleaned.replace(/[<(\[]?(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\/[a-zA-Z0-9_+.-]+(?:\?[^\s>\])]*)?[>)\]]?/gi, '');

    // 5. Remove generic redirect shortener URLs that redirect to promotional channels (tinyurl, bit.ly, etc.)
    cleaned = cleaned.replace(/[<(\[]?(?:https?:\/\/)?(?:www\.)?(?:tinyurl\.com|cutt\.ly|is\.gd|t\.co|rb\.gy|shorturl\.at|buff\.ly|ow\.ly)\/[a-zA-Z0-9_-]+(?:\?[^\s>\])]*)?[>)\]]?/gi, '');

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

/**
 * Main message processing pipeline:
 * 1. Drops offline dealer quote messages / B2B rate lists with no product links.
 * 2. Strips all foreign channels and promotional spam.
 * 3. Converts Amazon links to Associate Tag and non-Amazon store links (Reliance Digital, Flipkart, Myntra, etc.) via Cuelinks.
 * 4. Appends TechSelect Channel link.
 */
async function processMessageContent(body, newTag, amazonDomain, cuelinksApiKey, cuelinksChannelId) {
    if (!body || typeof body !== 'string') return '';

    // If message has no URLs or only has offline rate updates / B2B dealer quotes without e-commerce links, drop it!
    const rawUrls = body.match(/(https?:\/\/[^\s]+)/g);
    if (!rawUrls || rawUrls.length === 0) {
        // No links at all in message (e.g. offline price list like "17 256 85700 Req Sumit Bhiwani") -> DROP IT!
        return '';
    }

    // First strip all unwanted promotional texts, ANY 3rd party whatsapp channels, and redirect spam
    let updatedText = stripPromotionalContent(body);

    // Check if remaining text has any valid product / e-commerce links
    const remainingUrls = updatedText.match(/(https?:\/\/[^\s]+)/g);
    if (!remainingUrls || remainingUrls.length === 0) {
        // All links were spam channels or redirects -> DROP IT!
        return '';
    }

    const effectiveCuelinksKey = cuelinksApiKey || process.env.CUELINKS_API_KEY;
    const effectiveChannelId = cuelinksChannelId || process.env.CUELINKS_CHANNEL_ID || 311305;

    let hasValidStoreLink = false;

    for (const link of remainingUrls) {
        if (isAmazonUrl(link)) {
            const convertedLink = await convertAmazonLink(link, newTag, amazonDomain);
            updatedText = updatedText.replace(link, convertedLink);
            hasValidStoreLink = true;
        } else if (effectiveCuelinksKey) {
            // Non-Amazon store link (Reliance Digital, Flipkart, Myntra, Ajio, Croma, etc.) -> Cuelinks V3
            const convertedLink = await convertCuelinks(link, effectiveCuelinksKey, effectiveChannelId);
            updatedText = updatedText.replace(link, convertedLink);
            hasValidStoreLink = true;
        }
    }

    if (!hasValidStoreLink) {
        return '';
    }

    // Clean up trailing spaces and always append TechSelect channel link at the end
    updatedText = stripPromotionalContent(updatedText);
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
