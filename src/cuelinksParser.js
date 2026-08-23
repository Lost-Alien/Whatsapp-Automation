const axios = require('axios');
const { URL } = require('url');

const CUELINKS_API_ENDPOINT = 'https://developers.cuelinks.com/pub_api/v3/links/convert.json';
// Tech Select Mobile Deals WhatsApp Channel ID on Cuelinks
const DEFAULT_CHANNEL_ID = 311305;

/**
 * Extract target URL if an incoming URL is already a Cuelinks redirect (e.g. from competitor).
 * @param {string} rawUrl 
 * @returns {string}
 */
function extractTargetUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return rawUrl;
    try {
        if (rawUrl.includes('linksredirect.com') || rawUrl.includes('cuelinks.com')) {
            const parsed = new URL(rawUrl);
            const target = parsed.searchParams.get('url');
            if (target) return decodeURIComponent(target);
        }
    } catch (e) {
        // invalid URL format, return raw
    }
    return rawUrl;
}

/**
 * Direct Cuelinks redirect link builder (guaranteed fallback if API is unavailable).
 * @param {string} targetUrl 
 * @param {number|string} channelId 
 * @param {string} subid 
 * @returns {string}
 */
function buildCuelinksFallbackUrl(targetUrl, channelId = DEFAULT_CHANNEL_ID, subid = 'wabot') {
    if (!targetUrl) return targetUrl;
    return `https://linksredirect.com/?cid=${channelId}&subid1=${subid}&source=api&url=${encodeURIComponent(targetUrl)}`;
}

/**
 * Expand store shortlinks and mobile app deep links to full canonical URLs for optimal conversion.
 * Supports: Reliance Digital, Flipkart, Myntra, Ajio, Croma, JioMart, Vijay Sales, Shopsy, Earnkaro, etc.
 * @param {string} rawUrl 
 * @returns {Promise<string>}
 */
async function expandNonAmazonShortUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return rawUrl;
    const lower = rawUrl.toLowerCase();
    
    // Check if URL matches known merchant shortlinks or redirectors
    const isShortOrAppDomain = 
        lower.includes('fkrt.it') ||
        lower.includes('fkrt.co') ||
        lower.includes('dl.flipkart.com') ||
        lower.includes('myntr.it') ||
        lower.includes('ajio.co') ||
        lower.includes('croma.me') ||
        lower.includes('r-digital.in') ||
        lower.includes('reliancedigital.app.link') ||
        lower.includes('jiomart.app.link') ||
        lower.includes('ern.li') ||
        lower.includes('earnkaro.com') ||
        lower.includes('bit.ly') ||
        lower.includes('cutt.ly') ||
        lower.includes('is.gd') ||
        lower.includes('t.co') ||
        lower.includes('rb.gy') ||
        lower.includes('shorturl.at');

    if (isShortOrAppDomain) {
        try {
            const response = await axios.get(rawUrl, {
                maxRedirects: 5,
                timeout: 5000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            });
            return response.request?.res?.responseUrl || response.config?.url || rawUrl;
        } catch (err) {
            return rawUrl;
        }
    }
    return rawUrl;
}

/**
 * Convert any non-Amazon product URL (Reliance Digital, Flipkart, Myntra, Ajio, TataCliq, Croma, etc.)
 * into a Cuelinks tracked affiliate shortlink.
 * @param {string} rawUrl - Destination product/store URL.
 * @param {string} apiKey - Cuelinks V3 API token.
 * @param {number|string} [channelId] - Cuelinks Channel ID (default: 311305 for WhatsApp TechSelect).
 * @param {string} [subid] - Sub-ID attribution.
 * @returns {Promise<string>} The converted affiliate URL.
 */
async function convertCuelinks(rawUrl, apiKey, channelId = DEFAULT_CHANNEL_ID, subid = 'wabot') {
    if (!rawUrl) return rawUrl;

    // 1. Unwrap if competitor cuelinks link
    let targetUrl = extractTargetUrl(rawUrl);

    // 2. Expand known merchant shorteners if applicable
    targetUrl = await expandNonAmazonShortUrl(targetUrl);

    // Bypass Cuelinks API for Flipkart because their Captcha/WAF blocks Cuelinks verification
    // resulting in broken "Not Verified" fkrt.clnk.in shortlinks.
    if (targetUrl.includes('flipkart.com') || targetUrl.includes('fkrt.it') || targetUrl.includes('fkrt.co')) {
        console.log(`Bypassing Cuelinks API for Flipkart to avoid WAF block: ${targetUrl}`);
        return buildCuelinksFallbackUrl(targetUrl, channelId, subid);
    }

    // If no API key, use direct constructed Cuelinks redirect URL
    if (!apiKey) {
        return buildCuelinksFallbackUrl(targetUrl, channelId, subid);
    }

    try {
        const response = await axios.post(
            CUELINKS_API_ENDPOINT,
            {
                url: targetUrl,
                channel_id: Number(channelId) || DEFAULT_CHANNEL_ID,
                shorten: true,
                subid1: subid
            },
            {
                headers: {
                    'Authorization': `Token ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: 5000
            }
        );

        const data = response.data?.data;
        if (data) {
            return data.short_url || data.shorten_url || data.affiliate_url || data.tracking_url || buildCuelinksFallbackUrl(targetUrl, channelId, subid);
        }
        return buildCuelinksFallbackUrl(targetUrl, channelId, subid);
    } catch (err) {
        console.error(`⚠️ Cuelinks API failed for (${targetUrl}), falling back to direct redirect URL:`, err.message);
        // Resilient fallback to direct Cuelinks redirect URL
        return buildCuelinksFallbackUrl(targetUrl, channelId, subid);
    }
}

module.exports = {
    CUELINKS_API_ENDPOINT,
    DEFAULT_CHANNEL_ID,
    extractTargetUrl,
    buildCuelinksFallbackUrl,
    expandNonAmazonShortUrl,
    convertCuelinks
};
