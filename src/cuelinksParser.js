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
 * Expand store shortlinks (fkrt.it, myntr.it, etc.) to full URLs for optimal conversion.
 * @param {string} rawUrl 
 * @returns {Promise<string>}
 */
async function expandNonAmazonShortUrl(rawUrl) {
    if (!rawUrl) return rawUrl;
    const lower = rawUrl.toLowerCase();
    if (
        lower.includes('fkrt.it') ||
        lower.includes('myntr.it') ||
        lower.includes('ajio.co') ||
        lower.includes('ern.li') ||
        lower.includes('croma.me')
    ) {
        try {
            const response = await axios.get(rawUrl, {
                maxRedirects: 5,
                timeout: 8000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
                }
            });
            return response.request?.res?.responseUrl || rawUrl;
        } catch (err) {
            return rawUrl;
        }
    }
    return rawUrl;
}

/**
 * Convert any non-Amazon product URL into a Cuelinks tracked affiliate shortlink.
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
                timeout: 8000
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
