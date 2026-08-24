const axios = require('axios');
const { URL } = require('url');
const { sanitizeAmazonUrl } = require('./urlSanitizer');

const TARGET_CHANNEL_LINK = 'https://whatsapp.com/channel/0029VbDdnbkG3R3e7wu0g70C';
const CUELINKS_API_ENDPOINT = 'https://developers.cuelinks.com/pub_api/v3/links/convert.json';
const DEFAULT_CHANNEL_ID = 311305;
const AMAZON_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

/**
 * Per-merchant strategy table.
 * strategy: 'amazon' | 'flipkart' | 'cuelinks' | 'competitor'
 */
const MERCHANT_STRATEGIES = [
    { domains: ['amazon.in', 'amazon.com', 'amzn.to', 'amzn.eu', 'link.amazon', 'amzaff.to'], strategy: 'amazon' },
    { domains: ['flipkart.com', 'dl.flipkart.com', 'fkrt.it', 'fkrt.co', 'shopsy.in'], strategy: 'flipkart' },
    { domains: ['linksredirect.com', 'cuelinks.com'], strategy: 'competitor' },
    { domains: [
        'reliancedigital.in', 'r-digital.in', 'reliancedigital.app.link',
        'jiomart.com', 'jiomart.app.link',
        'myntra.com', 'myntr.it',
        'ajio.com', 'ajio.co',
        'croma.com', 'croma.me',
        'vijaysales.com', 'tatacliq.com', 'nykaa.com',
        'meesho.com', 'snapdeal.com',
        'earnkaro.com', 'ern.li',
        'bitli.in', 'linkredirect.in', 'wee.bnking.in', 'bnking.in', 'g.v20.in', 'v20.in',
        'wishlink.com', 'openinapp.co', 'openinapp.link', 'hypd.store',
        'inr.deals', 'inr.li', 'paisabazaar.com', 'bankbazaar.com', 'cardinsider.com',
        'sbicard.com', 'hdfcbank.com', 'axisbank.com', 'icicibank.com', 'kotak.com',
        'idfcfirstbank.com', 'indusind.com', 'aubank.in', 'rblbank.com', 'yesbank.in',
        'bobcard.co.in', 'bankofbaroda.in', 'hsbc.co.in', 'standardchartered.co.in',
    ], strategy: 'cuelinks' },
];

function detectStrategy(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return null;
    // Match against hostname only to avoid false positives from encoded URLs in query params
    let hostname;
    try {
        hostname = new URL(rawUrl).hostname.toLowerCase();
    } catch (_) {
        hostname = rawUrl.toLowerCase();
    }
    for (const entry of MERCHANT_STRATEGIES) {
        if (entry.domains.some(d => hostname.includes(d))) return entry.strategy;
    }
    return null;
}

function extractAsin(url) {
    if (!url) return null;
    const m = url.match(/(?:\/dp\/|\/gp\/product\/|\/gp\/aw\/d\/|\/o\/|\/product\/|\/ASIN\/|[?&]asin=)([A-Z0-9]{10})/i);
    return m ? m[1] : null;
}

/**
 * For link.amazon/XXXXXXXXXX — extract ASIN from path only if it is exactly 10 chars.
 * link.amazon uses 9-char IDs for non-ASIN shortlinks; we only use 10-char ones.
 */
function extractLinkAmazonPathAsin(rawUrl) {
    try {
        const parsed = new URL(rawUrl);
        if (!parsed.hostname.includes('link.amazon')) return null;
        const segment = parsed.pathname.replace(/^\//, '').split('/')[0];
        if (/^[A-Z0-9]{10}$/i.test(segment)) return segment;
    } catch (_) {}
    return null;
}

/**
 * Resolve Amazon shortlink via HTTP with WAF-bypassing headers.
 * Fast-fails at 3s per hop, max 3 hops.
 */
async function resolveAmazonShortUrl(rawUrl) {
    let currentUrl = rawUrl;
    const chain = [currentUrl];
    for (let i = 0; i < 3; i++) {
        try {
            const response = await axios.get(currentUrl, {
                maxRedirects: 0,
                timeout: 3000,
                validateStatus: (s) => s >= 200 && s < 400,
                headers: {
                    'User-Agent': AMAZON_UA,
                    'Referer': 'https://www.amazon.in/',
                    'Accept-Language': 'en-IN,en;q=0.9',
                },
            });
            if (response.status >= 300 && response.status < 400 && response.headers.location) {
                let next = response.headers.location;
                if (next.startsWith('/')) {
                    const base = new URL(currentUrl);
                    next = base.origin + next;
                }
                currentUrl = next;
                chain.push(currentUrl);
            } else {
                break;
            }
        } catch (err) {
            if (err.response && err.response.headers && err.response.headers.location) {
                let next = err.response.headers.location;
                try {
                    if (next.startsWith('/')) {
                        const base = new URL(currentUrl);
                        next = base.origin + next;
                    }
                } catch (_) {}
                currentUrl = next;
                chain.push(currentUrl);
            }
            break;
        }
    }
    return chain;
}

async function convertAmazon(rawUrl, newTag, amazonDomain) {
    if (!amazonDomain) amazonDomain = 'amazon.in';
    if (!rawUrl) return rawUrl;
    let url = sanitizeAmazonUrl(rawUrl);
    const lower = url.toLowerCase();
    const isShortLink = lower.includes('amzn.to') || lower.includes('amzn.eu')
        || lower.includes('link.amazon') || lower.includes('amzaff.to');

    if (isShortLink) {
        // Try path ASIN extraction first (free, instant)
        const pathAsin = extractLinkAmazonPathAsin(url);
        if (pathAsin) return 'https://www.' + amazonDomain + '/dp/' + pathAsin + '?tag=' + newTag;

        // HTTP resolution with WAF bypass
        const chain = await resolveAmazonShortUrl(url);
        for (let i = chain.length - 1; i >= 0; i--) {
            const asin = extractAsin(chain[i]);
            if (asin) return 'https://www.' + amazonDomain + '/dp/' + asin + '?tag=' + newTag;
        }

        // Fallback: use last resolved URL
        const lastUrl = chain[chain.length - 1];
        if (lastUrl.includes('tag=')) return lastUrl.replace(/tag=[a-zA-Z0-9._-]+/g, 'tag=' + newTag);
        const sep2 = lastUrl.includes('?') ? '&' : '?';
        return lastUrl + sep2 + 'tag=' + newTag;
    }

    const asin = extractAsin(url);
    if (asin) return 'https://www.' + amazonDomain + '/dp/' + asin + '?tag=' + newTag;
    if (url.includes('tag=')) return url.replace(/tag=[a-zA-Z0-9._-]+/g, 'tag=' + newTag);
    const sep = url.includes('?') ? '&' : '?';
    return url + sep + 'tag=' + newTag;
}

function buildCuelinksFallbackUrl(targetUrl, channelId, subid) {
    if (!channelId) channelId = DEFAULT_CHANNEL_ID;
    if (!subid) subid = 'wabot';
    if (!targetUrl) return targetUrl;
    return 'https://linksredirect.com/?cid=' + channelId + '&subid1=' + subid + '&source=api&url=' + encodeURIComponent(targetUrl);
}

function extractCompetitorTargetUrl(rawUrl) {
    try {
        if (rawUrl.includes('linksredirect.com') || rawUrl.includes('cuelinks.com')) {
            const parsed = new URL(rawUrl);
            const target = parsed.searchParams.get('url');
            if (target) return decodeURIComponent(target);
        }
    } catch (_) {}
    return rawUrl;
}

/**
 * Convert via Cuelinks API. Flipkart excluded — handled by convertFlipkart().
 */
async function convertViaCuelinks(rawUrl, apiKey, channelId, subid) {
    if (!channelId) channelId = DEFAULT_CHANNEL_ID;
    if (!subid) subid = 'wabot';
    if (!rawUrl) return rawUrl;
    if (!apiKey) return rawUrl;
    try {
        const response = await axios.post(
            CUELINKS_API_ENDPOINT,
            { url: rawUrl, channel_id: Number(channelId) || DEFAULT_CHANNEL_ID, shorten: true, subid1: subid },
            { headers: { 'Authorization': 'Token ' + apiKey, 'Content-Type': 'application/json' }, timeout: 5000 }
        );
        const data = response.data && response.data.data;
        if (data) {
            return data.short_url || data.shorten_url || data.affiliate_url || data.tracking_url
                || rawUrl;
        }
        return rawUrl;
    } catch (err) {
        console.error('Cuelinks API error for (' + rawUrl + '): ' + err.message);
        return rawUrl;
    }
}

/**
 * Flipkart: bypass Cuelinks API verification (WAF Captcha causes "Not Verified" links).
 */
function convertFlipkart(rawUrl, channelId, subid) {
    return buildCuelinksFallbackUrl(rawUrl, channelId, subid);
}

async function processLink(rawUrl, opts) {
    const strategy = detectStrategy(rawUrl);
    const subid = (opts && opts.subid) || 'wabot';
    const newTag = opts && opts.newTag;
    const amazonDomain = opts && opts.amazonDomain;
    const apiKey = opts && opts.apiKey;
    const channelId = opts && opts.channelId;

    switch (strategy) {
        case 'amazon': return convertAmazon(rawUrl, newTag, amazonDomain);
        case 'flipkart': return convertFlipkart(rawUrl, channelId, subid);
        case 'competitor': {
            const unwrapped = extractCompetitorTargetUrl(rawUrl);
            if (unwrapped !== rawUrl) return processLink(unwrapped, opts);
            return rawUrl;
        }
        case 'cuelinks': return convertViaCuelinks(rawUrl, apiKey, channelId, subid);
        default: return rawUrl;
    }
}

function stripPromotionalContent(text) {
    if (!text || typeof text !== 'string') return '';
    let c = text;
    c = c.replace(/^\s*Req\s+.*$/gim, '');
    c = c.replace(/\bReq\s+[a-zA-Z0-9_\s-]+\b/gi, '');
    c = c.replace(/Only Mobile,?\s*TV Electronic Deals\s*[\u{1F447}\u{1F449}\u{2B07}\uFE0F\u{1F517}]?/giu, '');
    c = c.replace(/All Loots,?\s*Mobile Deals & Rate update\s*[\u{1F447}\u{1F449}\u{2B07}\uFE0F\u{1F517}]?/giu, '');
    c = c.replace(/(?:Join|Follow)\s+(?:our|the|this)?\s*(?:WhatsApp|Telegram|Channel|Group|Deals)[^\n]*/gi, '');
    c = c.replace(/[<(\[]?(?:https?:\/\/)?(?:www\.)?whatsapp\.com\/channel\/[a-zA-Z0-9_-]+(?:\?[^\s>\])]*)? ?[>)\]]?/gi, '');
    c = c.replace(/[<(\[]?(?:https?:\/\/)?(?:www\.)?chat\.whatsapp\.com\/[a-zA-Z0-9_-]+(?:\?[^\s>\])]*)? ?[>)\]]?/gi, '');
    c = c.replace(/[<(\[]?(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\/[a-zA-Z0-9_+.-]+(?:\?[^\s>\])]*)? ?[>)\]]?/gi, '');
    c = c.replace(/[<(\[]?(?:https?:\/\/)?(?:www\.)?(?:tinyurl\.com|cutt\.ly|is\.gd|t\.co|rb\.gy|shorturl\.at|buff\.ly|ow\.ly)\/[a-zA-Z0-9_-]+(?:\?[^\s>\])]*)? ?[>)\]]?/gi, '');
    c = c.replace(/^\s*(?:Check\s+out|More\s+(?:loots?|deals?|offers?)|Join(?:\s+(?:other|our|the|this)?)?\s*(?:channel|group|now)?|Telegram|WhatsApp(?:\s+channel)?|Channel(?:\s+link)?|Follow(?:\s+us)?)\s*[:\-\u2013\u2014]?\s*$/gim, '');
    c = c.replace(/^[\s\u{1F447}\u{1F449}\u{2B07}\uFE0F\u{1F517}\u{1F4CC}\u2022\-\u2013\u2014*#:]+$/gmu, '');
    c = c.replace(/[\u{1F447}\u{1F449}\u{2B07}\uFE0F\u{1F517}]+\s*$/gmu, '');
    c = c.replace(/\n\s*\n\s*\n+/g, '\n\n');
    return c.trim();
}

async function processMessageContent(body, newTag, amazonDomain, cuelinksApiKey, cuelinksChannelId) {
    if (!body || typeof body !== 'string') return '';
    const rawUrls = body.match(/(https?:\/\/[^\s]+)/g);
    if (!rawUrls || rawUrls.length === 0) return '';

    let updatedText = stripPromotionalContent(body);
    const remainingUrls = updatedText.match(/(https?:\/\/[^\s]+)/g);
    if (!remainingUrls || remainingUrls.length === 0) return '';

    const apiKey = cuelinksApiKey || process.env.CUELINKS_API_KEY;
    const channelId = cuelinksChannelId || process.env.CUELINKS_CHANNEL_ID || DEFAULT_CHANNEL_ID;
    const opts = { newTag, amazonDomain, apiKey, channelId };

    const results = await Promise.allSettled(remainingUrls.map(async (link) => {
        const converted = await processLink(link, opts);
        return { original: link, converted: converted };
    }));

    let hasValidStoreLink = false;
    for (const result of results) {
        if (result.status === 'fulfilled') {
            const orig = result.value.original;
            const conv = result.value.converted;
            if (orig !== conv) {
                const esc = orig.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
                updatedText = updatedText.replace(new RegExp(esc, 'g'), conv);
                hasValidStoreLink = true;
            } else if (detectStrategy(orig) !== null) {
                hasValidStoreLink = true;
            }
        } else {
            console.error('Link processing failed: ' + result.reason);
            hasValidStoreLink = true;
        }
    }

    if (!hasValidStoreLink) return '';
    updatedText = stripPromotionalContent(updatedText).trim();
    if (updatedText) updatedText += '\n\n' + TARGET_CHANNEL_LINK;
    return updatedText;
}

module.exports = {
    TARGET_CHANNEL_LINK, CUELINKS_API_ENDPOINT, DEFAULT_CHANNEL_ID,
    MERCHANT_STRATEGIES,
    detectStrategy, extractAsin, extractLinkAmazonPathAsin, resolveAmazonShortUrl,
    convertAmazon, convertFlipkart, convertViaCuelinks, buildCuelinksFallbackUrl,
    extractCompetitorTargetUrl, processLink, stripPromotionalContent, processMessageContent,
};
