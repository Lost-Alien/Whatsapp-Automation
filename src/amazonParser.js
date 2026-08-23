const axios = require('axios');
const { convertCuelinks } = require('./cuelinksParser');
const { sanitizeAmazonUrl } = require('./urlSanitizer');

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

/**
 * Resolve Amazon short links manually by following location headers up to 5 hops
 * to bypass javascript redirects/bots checks if any, and importantly to get the full
 * redirect chain to extract the ASIN from any intermediate step, and ignore competitor tags.
 */
async function resolveAmazonShortUrl(rawUrl) {
    let currentUrl = rawUrl;
    let chain = [currentUrl];
    
    try {
        for (let i = 0; i < 5; i++) {
            const response = await axios.get(currentUrl, {
                maxRedirects: 0,
                timeout: 5000,
                validateStatus: (status) => status >= 200 && status < 400,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            });
            
            if (response.status >= 300 && response.status < 400 && response.headers.location) {
                let nextUrl = response.headers.location;
                if (nextUrl.startsWith('/')) {
                    const parsedUrl = new URL(currentUrl);
                    nextUrl = `${parsedUrl.origin}${nextUrl}`;
                }
                currentUrl = nextUrl;
                chain.push(currentUrl);
            } else {
                break;
            }
        }
    } catch (err) {
        console.error(`⚠️ Error resolving link chain (${rawUrl}):`, err.message);
    }
    return chain;
}

function extractAsin(url) {
    const asinMatch = url.match(/(?:\/dp\/|\/gp\/product\/|\/gp\/aw\/d\/|\/o\/|\/product\/|\/ASIN\/|[?&]asin=)([a-zA-Z0-9]{10})/i);
    return asinMatch ? asinMatch[1] : null;
}

async function convertAmazonLink(rawUrl, newTag, amazonDomain = 'amazon.in') {
    if (!rawUrl) return rawUrl;

    // 1. Sanitize to strip double-tags, fragments, junk
    let sanitizedUrl = sanitizeAmazonUrl(rawUrl);

    // Check if it is a shortened Amazon URL
    const lowerUrl = sanitizedUrl.toLowerCase();
    if (
        lowerUrl.includes('amzn.to') || 
        lowerUrl.includes('amzn.eu') || 
        lowerUrl.includes('link.amazon') || 
        lowerUrl.includes('amzaff.to')
    ) {
        const chain = await resolveAmazonShortUrl(sanitizedUrl);
        // Look for ASIN in any hop of the chain (from last to first)
        for (let i = chain.length - 1; i >= 0; i--) {
            const asin = extractAsin(chain[i]);
            if (asin) {
                return `https://www.${amazonDomain}/dp/${asin}?tag=${newTag}`;
            }
        }
        // If resolution fails to find ASIN, fallback to the last hop of the chain but sanitized
        sanitizedUrl = sanitizeAmazonUrl(chain[chain.length - 1]);
    } else {
        const asin = extractAsin(sanitizedUrl);
        if (asin) {
            return `https://www.${amazonDomain}/dp/${asin}?tag=${newTag}`;
        }
    }

    // Fallback: If tag already exists on standard URL, replace it
    if (sanitizedUrl.includes('tag=')) {
        return sanitizedUrl.replace(/tag=[a-zA-Z0-9._-]+/g, `tag=${newTag}`);
    }

    // Fallback: append the tag
    const separator = sanitizedUrl.includes('?') ? '&' : '?';
    return `${sanitizedUrl}${separator}tag=${newTag}`;
}

function stripPromotionalContent(text) {
    if (!text || typeof text !== 'string') return '';

    let cleaned = text;

    cleaned = cleaned.replace(/^\s*Req\s+.*$/gim, '');
    cleaned = cleaned.replace(/\bReq\s+[a-zA-Z0-9_\s-]+\b/gi, '');

    cleaned = cleaned.replace(/Only Mobile,?\s*TV Electronic Deals\s*[👇👉⬇️🔗]?/gi, '');
    cleaned = cleaned.replace(/All Loots,?\s*Mobile Deals & Rate update\s*[👇👉⬇️🔗]?/gi, '');
    cleaned = cleaned.replace(/(?:Join|Follow)\s+(?:our|the|this)?\s*(?:WhatsApp|Telegram|Channel|Group|Deals)[^\n]*/gi, '');

    cleaned = cleaned.replace(/[<(\[]?(?:https?:\/\/)?(?:www\.)?whatsapp\.com\/channel\/[a-zA-Z0-9_-]+(?:\?[^\s>\])]*)?[>)\]]?/gi, '');
    cleaned = cleaned.replace(/[<(\[]?(?:https?:\/\/)?(?:www\.)?chat\.whatsapp\.com\/[a-zA-Z0-9_-]+(?:\?[^\s>\])]*)?[>)\]]?/gi, '');

    cleaned = cleaned.replace(/[<(\[]?(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\/[a-zA-Z0-9_+.-]+(?:\?[^\s>\])]*)?[>)\]]?/gi, '');

    cleaned = cleaned.replace(/[<(\[]?(?:https?:\/\/)?(?:www\.)?(?:tinyurl\.com|cutt\.ly|is\.gd|t\.co|rb\.gy|shorturl\.at|buff\.ly|ow\.ly)\/[a-zA-Z0-9_-]+(?:\?[^\s>\])]*)?[>)\]]?/gi, '');

    cleaned = cleaned.replace(/^\s*(?:Check\s+out|More\s+(?:loots?|deals?|offers?)|Join(?:\s+(?:other|our|the|this)?)?\s*(?:channel|group|now)?|Telegram|WhatsApp(?:\s+channel)?|Channel(?:\s+link)?|Follow(?:\s+us)?)\s*[:\-–—]?\s*$/gim, '');

    cleaned = cleaned.replace(/^[\s👇👉⬇️🔗📌•\-–—*#:]+$/gm, '');
    cleaned = cleaned.replace(/[👇👉⬇️🔗]+\s*$/gm, '');

    cleaned = cleaned.replace(/\n\s*\n\s*\n+/g, '\n\n');
    cleaned = cleaned.trim();

    return cleaned;
}

/**
 * Main message processing pipeline:
 * Drops offline dealer quote messages
 * Strips channels and promo spam
 * Converts Amazon links and Non-Amazon links in parallel
 * Appends TechSelect Channel link
 */
async function processMessageContent(body, newTag, amazonDomain, cuelinksApiKey, cuelinksChannelId) {
    if (!body || typeof body !== 'string') return '';

    const rawUrls = body.match(/(https?:\/\/[^\s]+)/g);
    if (!rawUrls || rawUrls.length === 0) {
        return '';
    }

    let updatedText = stripPromotionalContent(body);

    const remainingUrls = updatedText.match(/(https?:\/\/[^\s]+)/g);
    if (!remainingUrls || remainingUrls.length === 0) {
        return '';
    }

    const effectiveCuelinksKey = cuelinksApiKey || process.env.CUELINKS_API_KEY;
    const effectiveChannelId = cuelinksChannelId || process.env.CUELINKS_CHANNEL_ID || 311305;

    // Parallel link resolution
    const linkPromises = remainingUrls.map(async (link) => {
        if (isAmazonUrl(link)) {
            const converted = await convertAmazonLink(link, newTag, amazonDomain);
            return { original: link, converted };
        } else if (effectiveCuelinksKey) {
            const converted = await convertCuelinks(link, effectiveCuelinksKey, effectiveChannelId);
            return { original: link, converted };
        }
        return { original: link, converted: link };
    });

    const results = await Promise.allSettled(linkPromises);
    
    let hasValidStoreLink = false;

    // Map original URLs to converted URLs
    for (const result of results) {
        if (result.status === 'fulfilled') {
            const { original, converted } = result.value;
            if (original !== converted) {
                // Escape original for regex replacement
                const escapedOriginal = original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                updatedText = updatedText.replace(new RegExp(escapedOriginal, 'g'), converted);
                hasValidStoreLink = true;
            } else if (isAmazonUrl(original) || (effectiveCuelinksKey && original === converted)) {
                // If it was already converted and unchanged or Cuelinks returned original
                hasValidStoreLink = true;
            }
        } else {
            // Promise rejected, keep the original link and log error
            console.error(`⚠️ Link resolution failed for ${result.reason}`);
            hasValidStoreLink = true; // We keep the original link if it fails.
        }
    }

    if (!hasValidStoreLink) {
        return '';
    }

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
    resolveAmazonShortUrl,
    convertAmazonLink,
    convertCuelinks,
    stripPromotionalContent,
    processMessageContent
};
