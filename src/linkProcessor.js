const axios = require('axios');
const { URL } = require('url');
const { sanitizeAmazonUrl } = require('./urlSanitizer');
const { mapSettled } = require('./concurrency');

const TARGET_CHANNEL_LINK = 'https://whatsapp.com/channel/0029VbDdnbkG3R3e7wu0g70C';
const CUELINKS_API_ENDPOINT = 'https://developers.cuelinks.com/pub_api/v3/links/convert.json';
const DEFAULT_CHANNEL_ID = 311305;
const AMAZON_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

const FLIPKART_DOMAINS = [
    'flipkart.com', 'dl.flipkart.com', 'shopsy.in',
    'fkrt.it', 'fkrt.co', 'fkrt.in', 'fkrt.cc', 'fkrt.to', 'fkrt.link', 'fkrt.me',
    'fkr.in', 'fkr.co', 'fkr.cc', 'fkr.to', 'fkr.it',
    'bilty.co', 'bilty.in',
];

const FK_SHORT_HOSTS = [
    'fkrt.it', 'fkrt.co', 'fkrt.in', 'fkrt.cc', 'fkrt.to', 'fkrt.link', 'fkrt.me',
    'fkr.in', 'fkr.co', 'fkr.cc', 'fkr.to', 'fkr.it',
    'bilty.co', 'bilty.in', 'dl.flipkart.com'
];

/**
 * Per-merchant strategy table.
 * strategy: 'amazon' | 'flipkart' | 'cuelinks' | 'competitor'
 */
const MERCHANT_STRATEGIES = [
    { domains: ['amazon.in', 'amazon.com', 'amzn.to', 'amzn.eu', 'link.amazon', 'amzaff.to'], strategy: 'amazon' },
    { domains: FLIPKART_DOMAINS, strategy: 'flipkart' },
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

function isFlipkartUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return false;
    let hostname;
    try {
        hostname = new URL(rawUrl).hostname.toLowerCase();
    } catch (_) {
        hostname = rawUrl.toLowerCase();
    }
    return FLIPKART_DOMAINS.some(d => hostname.includes(d));
}

function hasFlipkartLink(text) {
    if (!text || typeof text !== 'string') return false;
    return /https?:\/\/(?:[a-zA-Z0-9-]+\.)*(?:flipkart\.com|shopsy\.in|fkrt\.(?:it|co|in|cc|to|link|me)|fkr\.(?:in|co|cc|to|it)|bilty\.(?:co|in)|dl\.flipkart\.com)/i.test(text);
}

function extractFlipkartLinks(text) {
    if (!text || typeof text !== 'string') return [];
    const matches = text.match(/https?:\/\/(?:[a-zA-Z0-9-]+\.)*(?:flipkart\.com|shopsy\.in|fkrt\.(?:it|co|in|cc|to|link|me)|fkr\.(?:in|co|cc|to|it)|bilty\.(?:co|in)|dl\.flipkart\.com)[^\s]*/gi);
    return matches || [];
}

function cleanTrailingPunctuation(url) {
    if (!url || typeof url !== 'string') return url;
    return url.replace(/[.,;:!?)\]*>]+$/, '');
}

function detectStrategy(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return null;
    let hostname;
    try {
        hostname = new URL(rawUrl).hostname.toLowerCase();
    } catch (_) {
        hostname = rawUrl.toLowerCase();
    }
    if (isFlipkartUrl(rawUrl)) return 'flipkart';
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
 * For link.amazon/XXXXXXXXXX: extract ASIN from path only if it is exactly 10 chars.
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
                maxContentLength: 262144,
                maxBodyLength: 65536,
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

/**
 * Strip existing Flipkart affiliate tracking params from a canonical URL before re-tagging.
 * remove_existing_tracking_ids: strips affid, affExtParam*, vsugd, otracker, pid, lid
 */
function sanitizeFlipkartUrl(url) {
    if (!url) return url;
    try {
        const parsed = new URL(url);
        // Only strip params from flipkart.com and shopsy.in canonical URLs, keep short links intact
        if (!parsed.hostname.includes('flipkart.com') && !parsed.hostname.includes('shopsy.in')) return url;
        ['affid', 'affExtParam1', 'affExtParam2', 'vsugd', 'otracker', 'pid', 'lid', 'ssid'].forEach(p => parsed.searchParams.delete(p));
        return parsed.toString();
    } catch (_) { return url; }
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
 * Unwrap common deep-link redirectors (openinapp.co, openinapp.link, earnkaro, etc.)
 * that embed the real merchant URL in a query param.
 * Returns the underlying URL if found, else the original.
 */
function unwrapDeepLink(rawUrl) {
    const DEEP_LINK_PARAMS = ['url', 'link', 'target', 'dest', 'redirect', 'u', 'to', 'ref'];
    try {
        const parsed = new URL(rawUrl);
        const h = parsed.hostname.toLowerCase();
        const deepLinkHosts = [
            'openinapp.co', 'openinapp.link', 'earnkaro.com', 'ern.li',
            'bitli.in', 'linkredirect.in', 'wishlink.com', 'hypd.store',
            'inr.deals', 'inr.li', 'g.v20.in', 'v20.in', 'wee.bnking.in', 'bnking.in',
        ];
        if (!deepLinkHosts.some(d => h.includes(d))) return rawUrl;
        for (const param of DEEP_LINK_PARAMS) {
            const val = parsed.searchParams.get(param);
            if (val && (val.startsWith('http://') || val.startsWith('https://'))) {
                return decodeURIComponent(val);
            }
        }
    } catch (_) {}
    return rawUrl;
}

/**
 * Convert via Cuelinks API. Flipkart excluded: handled by convertFlipkart().
 */
async function convertViaCuelinks(rawUrl, apiKey, channelId, subid) {
    if (!channelId) channelId = DEFAULT_CHANNEL_ID;
    if (!subid) subid = 'wabot';
    if (!rawUrl) return rawUrl;
    if (!apiKey) return buildCuelinksFallbackUrl(rawUrl, channelId, subid);
    try {
        const response = await axios.post(
            CUELINKS_API_ENDPOINT,
            { url: rawUrl, channel_id: Number(channelId) || DEFAULT_CHANNEL_ID, shorten: true, subid1: subid },
            { headers: { 'Authorization': 'Token ' + apiKey, 'Content-Type': 'application/json' }, timeout: 5000,
                maxContentLength: 262144, maxBodyLength: 65536 }
        );
        const data = response.data && response.data.data;
        if (data) {
            return data.short_url || data.shorten_url || data.affiliate_url || data.tracking_url
                || buildCuelinksFallbackUrl(rawUrl, channelId, subid);
        }
        return buildCuelinksFallbackUrl(rawUrl, channelId, subid);
    } catch (err) {
        console.error('Cuelinks API error for (' + rawUrl + '): ' + err.message);
        return buildCuelinksFallbackUrl(rawUrl, channelId, subid);
    }
}

/**
 * Resolve Flipkart short links (fkrt.it, fkrt.co, fkrt.cc, bilty.co, fkr.in, dl.flipkart.com, etc.)
 * to the final canonical flipkart.com product URL by following the redirect chain.
 */
async function resolveFlipkartShortUrl(rawUrl) {
    if (!rawUrl) return rawUrl;
    let cleanUrl = cleanTrailingPunctuation(rawUrl);
    let hostname;
    try { hostname = new URL(cleanUrl).hostname.toLowerCase(); } catch (_) { return cleanUrl; }

    // Only follow redirects for known short-link domains
    const needsExpansion = FK_SHORT_HOSTS.some(d => hostname.includes(d));
    if (!needsExpansion) return cleanUrl;

    let currentUrl = cleanUrl;
    for (let i = 0; i < 5; i++) {
        try {
            const resp = await axios.get(currentUrl, {
                maxRedirects: 0,
                maxContentLength: 262144,
                maxBodyLength: 65536,
                timeout: 4000,
                validateStatus: s => s >= 200 && s < 400,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
                    'Accept-Language': 'en-IN,en;q=0.9',
                },
            });
            if (resp.status >= 300 && resp.status < 400 && resp.headers.location) {
                let next = resp.headers.location;
                if (next.startsWith('/')) { const b = new URL(currentUrl); next = b.origin + next; }
                currentUrl = next;
            } else {
                if (resp.data && typeof resp.data === 'string') {
                    const bodyMatch = resp.data.match(/https?:\/\/(?:www\.)?(?:flipkart\.com|shopsy\.in)\/[^\s"'<>&]+/i);
                    if (bodyMatch) { currentUrl = bodyMatch[0]; }
                }
                break;
            }
        } catch (err) {
            if (err.response && err.response.headers && err.response.headers.location) {
                let next = err.response.headers.location;
                try { if (next.startsWith('/')) { const b = new URL(currentUrl); next = b.origin + next; } } catch (_) {}
                currentUrl = next;
            } else if (err.response && err.response.data && typeof err.response.data === 'string') {
                const bodyMatch = err.response.data.match(/https?:\/\/(?:www\.)?(?:flipkart\.com|shopsy\.in)\/[^\s"'<>&]+/i);
                if (bodyMatch) { currentUrl = bodyMatch[0]; }
            }
            break;
        }
    }
    return currentUrl;
}

/**
 * Flipkart: resolve short WAP links first, then wrap with Cuelinks linksredirect.
 * Resilient fallback: always returns a working Cuelinks redirect URL even if resolution
 * or parameter stripping fails or times out.
 */
async function convertFlipkart(rawUrl, channelId, subid) {
    if (!rawUrl) return rawUrl;
    const cleanRaw = cleanTrailingPunctuation(rawUrl);
    try {
        const resolved = await resolveFlipkartShortUrl(cleanRaw);
        const clean = sanitizeFlipkartUrl(resolved || cleanRaw);
        return buildCuelinksFallbackUrl(clean, channelId, subid);
    } catch (err) {
        console.error('convertFlipkart failed for (' + rawUrl + '): ' + err.message);
        return buildCuelinksFallbackUrl(cleanRaw, channelId, subid);
    }
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
        case 'flipkart': return await convertFlipkart(rawUrl, channelId, subid);
        case 'competitor': {
            const unwrapped = extractCompetitorTargetUrl(rawUrl);
            if (unwrapped !== rawUrl) return processLink(unwrapped, opts);
            return rawUrl;
        }
        case 'cuelinks': return convertViaCuelinks(rawUrl, apiKey, channelId, subid);
        default: return rawUrl;
    }
}

/**
 * Dynamic strip words from STRIP_WORDS env var.
 */
const EXTRA_STRIP_WORDS = (process.env.STRIP_WORDS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

function stripPromotionalContent(text) {
    if (!text || typeof text !== 'string') return '';
    let c = text;

    // Strip lines starting with Req, unless the line contains a link
    c = c.split('\n').map(line => {
        if (/^\s*Req\b/i.test(line)) {
            if (/https?:\/\//i.test(line)) {
                return line.replace(/^\s*Req\b\s*[^\s:]*[:\s-]*/i, '');
            }
            return '';
        }
        return line;
    }).join('\n');

    c = c.replace(/\bReq\s+[a-zA-Z0-9_\s-]+\b/gi, '');
    c = c.replace(/Only Mobile,?\s*TV Electronic Deals\s*[\u{1F447}\u{1F449}\u{2B07}\uFE0F\u{1F517}]?/giu, '');
    c = c.replace(/All Loots,?\s*Mobile Deals & Rate update\s*[\u{1F447}\u{1F449}\u{2B07}\uFE0F\u{1F517}]?/giu, '');
    c = c.replace(/(?:Join|Follow)\s+(?:our|the|this)?\s*(?:WhatsApp|Telegram|Channel|Group|Deals)(?:\s*[:\-\u2013\u2014])?/gi, '');
    c = c.replace(/[<(\[]?(?:https?:\/\/)?(?:www\.)?whatsapp\.com\/channel\/[a-zA-Z0-9_-]+(?:\?[^\s>\])]*)? ?[>)\]]?/gi, '');
    c = c.replace(/[<(\[]?(?:https?:\/\/)?(?:www\.)?chat\.whatsapp\.com\/[a-zA-Z0-9_-]+(?:\?[^\s>\])]*)? ?[>)\]]?/gi, '');
    c = c.replace(/[<(\[]?(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\/[a-zA-Z0-9_+.-]+(?:\?[^\s>\])]*)? ?[>)\]]?/gi, '');
    c = c.replace(/[<(\[]?(?:https?:\/\/)?(?:www\.)?(?:tinyurl\.com|cutt\.ly|is\.gd|t\.co|rb\.gy|shorturl\.at|buff\.ly|ow\.ly)\/[a-zA-Z0-9_-]+(?:\?[^\s>\])]*)? ?[>)\]]?/gi, '');
    c = c.replace(/^\s*(?:Check\s+out|More\s+(?:loots?|deals?|offers?)|Join(?:\s+(?:other|our|the|this)?)?\s*(?:channel|group|now)?|Telegram|WhatsApp(?:\s+channel)?|Channel(?:\s+link)?|Follow(?:\s+us)?)\s*[:\-\u2013\u2014]?\s*$/gim, '');
    c = c.replace(/^[\s\u{1F447}\u{1F449}\u{2B07}\uFE0F\u{1F517}\u{1F4CC}\u2022\-\u2013\u2014*#:]+$/gmu, '');
    c = c.replace(/[\u{1F447}\u{1F449}\u{2B07}\uFE0F\u{1F517}]+\s*$/gmu, '');

    // Apply dynamic STRIP_WORDS from .env
    if (EXTRA_STRIP_WORDS.length > 0) {
        const escaped = EXTRA_STRIP_WORDS.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        const dynamicPattern = new RegExp('(?:^|\\s)(?:' + escaped.join('|') + ')(?:\\s|$)', 'gim');
        c = c.replace(dynamicPattern, ' ');
    }
    c = c.replace(/\n\s*\n\s*\n+/g, '\n\n');
    return c.trim();
}

/**
 * Minimum meaningful text length after stripping: prevents forwarding near-empty messages.
 */
const MIN_CONTENT_LENGTH = 15;

async function processMessageContent(body, newTag, amazonDomain, cuelinksApiKey, cuelinksChannelId) {
    if (!body || typeof body !== 'string') return '';

    const originalHasFlipkart = hasFlipkartLink(body) || isFlipkartUrl(body);
    const originalFkLinks = originalHasFlipkart ? extractFlipkartLinks(body) : [];

    // Step 1: Strip ALL competitor channel/group invite links and promo noise
    let updatedText = stripPromotionalContent(body);

    // Step 2: Bail early if no meaningful content remains (ALLOW all Flipkart links even if short)
    if (!originalHasFlipkart && (!updatedText || updatedText.trim().length < MIN_CONTENT_LENGTH)) {
        return '';
    }

    // If original message had Flipkart link(s) but promo stripping erased them, restore them
    if (originalHasFlipkart) {
        for (const rawFk of originalFkLinks) {
            const cleanFk = cleanTrailingPunctuation(rawFk);
            if (!updatedText.includes(cleanFk) && !updatedText.includes(rawFk)) {
                updatedText = updatedText ? (updatedText + '\n' + cleanFk) : cleanFk;
            }
        }
    }

    const apiKey = cuelinksApiKey || process.env.CUELINKS_API_KEY;
    const channelId = cuelinksChannelId || process.env.CUELINKS_CHANNEL_ID || DEFAULT_CHANNEL_ID;
    const opts = { newTag, amazonDomain, apiKey, channelId };

    // Step 3: Convert any affiliate-eligible links found in the cleaned text
    const remainingUrls = updatedText.match(/(https?:\/\/[^\s]+)/g);
    if (remainingUrls && remainingUrls.length > 0) {
        const uniqueUrls = [...new Set(remainingUrls)];
        if (uniqueUrls.length > 50) throw new Error('Message exceeds 50 unique URLs');
        const results = await mapSettled(uniqueUrls, 2, async (link) => {
            const cleanLink = cleanTrailingPunctuation(link);
            const trailing = link.substring(cleanLink.length);

            // Try to unwrap deep-link redirectors before strategy detection
            const unwrapped = unwrapDeepLink(cleanLink);
            const effectiveLink = unwrapped !== cleanLink ? unwrapped : cleanLink;
            const converted = await processLink(effectiveLink, opts);
            return { original: link, converted: converted + trailing };
        });

        for (const result of results) {
            if (result.status === 'fulfilled') {
                const { original: orig, converted: conv } = result.value;
                if (orig !== conv) {
                    const esc = orig.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
                    updatedText = updatedText.replace(new RegExp(esc, 'g'), conv);
                }
            } else {
                console.error('Link processing failed: ' + result.reason);
            }
        }
    }

    // Step 4: Final clean-up pass and always append our channel link
    let finalClean = stripPromotionalContent(updatedText).trim();

    if (originalHasFlipkart) {
        if (!finalClean || finalClean.length === 0) {
            finalClean = updatedText.trim();
        }
    } else {
        if (!finalClean || finalClean.length < MIN_CONTENT_LENGTH) return '';
    }

    if (!finalClean || finalClean.length === 0) return '';

    if (!finalClean.includes(TARGET_CHANNEL_LINK)) {
        finalClean += '\n\n' + TARGET_CHANNEL_LINK;
    }
    return finalClean;
}

module.exports = {
    TARGET_CHANNEL_LINK, CUELINKS_API_ENDPOINT, DEFAULT_CHANNEL_ID,
    FLIPKART_DOMAINS, FK_SHORT_HOSTS, MERCHANT_STRATEGIES, MIN_CONTENT_LENGTH, EXTRA_STRIP_WORDS,
    isFlipkartUrl, hasFlipkartLink, extractFlipkartLinks, cleanTrailingPunctuation,
    detectStrategy, extractAsin, extractLinkAmazonPathAsin, resolveAmazonShortUrl,
    sanitizeFlipkartUrl, resolveFlipkartShortUrl,
    convertAmazon, convertFlipkart, convertViaCuelinks, buildCuelinksFallbackUrl,
    extractCompetitorTargetUrl, unwrapDeepLink, processLink,
    stripPromotionalContent, processMessageContent,
};
