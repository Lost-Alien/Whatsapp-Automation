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
    // Flipkart + all known WAP short-link domains (2024–2026)
    // Source: community research - fkrt.it, bilty.co, dl.flipkart.com are confirmed redirect chains
    // fkr.in, fkr.co, fkrt.in are newer WAP shortener variants observed in affiliate channels
    { domains: [
        'flipkart.com', 'dl.flipkart.com', 'shopsy.in',
        'fkrt.it', 'fkrt.co', 'fkrt.in',
        'fkr.in', 'fkr.co',
        'bilty.co', 'bilty.in',
    ], strategy: 'flipkart' },
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

/**
 * Strip existing Flipkart affiliate tracking params from a URL before re-tagging.
 * Ported from da-vinci-noob/telegram-affiliate-link-generator-bot (Ruby: affiliateprocess.rb)
 * remove_existing_tracking_ids — strips: affid, affExtParam*, vsugd, otracker, pid, lid
 */
function sanitizeFlipkartUrl(url) {
    if (!url) return url;
    try {
        const parsed = new URL(url);
        // Only strip params from flipkart.com canonical URLs — not short-link domains
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
 * Convert via Cuelinks API. Flipkart excluded — handled by convertFlipkart().
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
            { headers: { 'Authorization': 'Token ' + apiKey, 'Content-Type': 'application/json' }, timeout: 5000 }
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
 * Resolve Flipkart short links (fkrt.it, bilty.co, fkr.in, dl.flipkart.com, etc.)
 * to the final canonical flipkart.com product URL by following the redirect chain.
 * Reference approach: community repos (da-vinci-noob/telegram-affiliate-link-generator-bot)
 * use the same redirect-following strategy for Flipkart WAP links.
 */
async function resolveFlipkartShortUrl(rawUrl) {
    const FK_SHORT_HOSTS = ['fkrt.it', 'fkrt.co', 'fkrt.in', 'fkr.in', 'fkr.co', 'bilty.co', 'bilty.in', 'dl.flipkart.com'];
    let hostname;
    try { hostname = new URL(rawUrl).hostname.toLowerCase(); } catch (_) { return rawUrl; }

    // Only follow redirects for known short-link domains
    const needsExpansion = FK_SHORT_HOSTS.some(d => hostname.includes(d));
    if (!needsExpansion) return rawUrl;

    let currentUrl = rawUrl;
    for (let i = 0; i < 5; i++) {
        try {
            const resp = await axios.get(currentUrl, {
                maxRedirects: 0,
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
                // Phase 3: HTML body fallback — ported from process_url.rb redirection()
                // When bilty.co/fkrt serve a WAP HTML page instead of a clean 302,
                // scan the response body for an embedded canonical flipkart.com URL.
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
                // Body scan even on error responses (e.g. 403 with HTML redirect page)
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
 * Bypasses Cuelinks API for Flipkart (WAF Captcha causes "Not Verified" affiliate links).
 * Educational reference: github.com/da-vinci-noob/telegram-affiliate-link-generator-bot
 */
async function convertFlipkart(rawUrl, channelId, subid) {
    const resolved = await resolveFlipkartShortUrl(rawUrl);
    // Phase 2: Strip old Flipkart affiliate params before re-tagging (affiliateprocess.rb pattern)
    const clean = sanitizeFlipkartUrl(resolved);
    return buildCuelinksFallbackUrl(clean, channelId, subid);
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
 * Phase 4: Dynamic strip words from STRIP_WORDS env var.
 * Ported from da-vinci-noob/telegram-affiliate-link-generator-bot (bot.rb delete word list).
 * Usage in .env: STRIP_WORDS=Req Jind,Req Tohana,offline rate,Req sachin
 * These are applied AFTER built-in promo stripping, so no redeploy needed for new patterns.
 */
const EXTRA_STRIP_WORDS = (process.env.STRIP_WORDS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

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
    // Phase 4: Apply dynamic STRIP_WORDS from .env (bot.rb delete-list pattern)
    if (EXTRA_STRIP_WORDS.length > 0) {
        const escaped = EXTRA_STRIP_WORDS.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        const dynamicPattern = new RegExp('(?:^|\\s)(?:' + escaped.join('|') + ')(?:\\s|$)', 'gim');
        c = c.replace(dynamicPattern, ' ');
    }
    c = c.replace(/\n\s*\n\s*\n+/g, '\n\n');
    return c.trim();
}

/**
 * Minimum meaningful text length after stripping — prevents forwarding near-empty messages.
 */
const MIN_CONTENT_LENGTH = 15;

async function processMessageContent(body, newTag, amazonDomain, cuelinksApiKey, cuelinksChannelId) {
    if (!body || typeof body !== 'string') return '';

    // Step 1: Strip ALL competitor channel/group invite links and promo noise
    let updatedText = stripPromotionalContent(body);

    // Step 2: Bail early if no meaningful content remains
    if (!updatedText || updatedText.trim().length < MIN_CONTENT_LENGTH) return '';

    const apiKey = cuelinksApiKey || process.env.CUELINKS_API_KEY;
    const channelId = cuelinksChannelId || process.env.CUELINKS_CHANNEL_ID || DEFAULT_CHANNEL_ID;
    const opts = { newTag, amazonDomain, apiKey, channelId };

    // Step 3: Convert any affiliate-eligible links found in the cleaned text
    const remainingUrls = updatedText.match(/(https?:\/\/[^\s]+)/g);
    if (remainingUrls && remainingUrls.length > 0) {
        const results = await Promise.allSettled(remainingUrls.map(async (link) => {
            // Try to unwrap deep-link redirectors before strategy detection
            const unwrapped = unwrapDeepLink(link);
            const effectiveLink = unwrapped !== link ? unwrapped : link;
            const converted = await processLink(effectiveLink, opts);
            return { original: link, converted };
        }));

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
    updatedText = stripPromotionalContent(updatedText).trim();
    if (!updatedText || updatedText.length < MIN_CONTENT_LENGTH) return '';

    updatedText += '\n\n' + TARGET_CHANNEL_LINK;
    return updatedText;
}

module.exports = {
    TARGET_CHANNEL_LINK, CUELINKS_API_ENDPOINT, DEFAULT_CHANNEL_ID,
    MERCHANT_STRATEGIES, MIN_CONTENT_LENGTH, EXTRA_STRIP_WORDS,
    detectStrategy, extractAsin, extractLinkAmazonPathAsin, resolveAmazonShortUrl,
    sanitizeFlipkartUrl, resolveFlipkartShortUrl,
    convertAmazon, convertFlipkart, convertViaCuelinks, buildCuelinksFallbackUrl,
    extractCompetitorTargetUrl, unwrapDeepLink, processLink,
    stripPromotionalContent, processMessageContent,
};
