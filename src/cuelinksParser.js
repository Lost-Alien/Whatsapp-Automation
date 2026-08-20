const axios = require('axios');

const CUELINKS_API_ENDPOINT = 'https://developers.cuelinks.com/pub_api/v3/links/convert.json';

/**
 * Convert any non-Amazon product URL into a Cuelinks tracked affiliate shortlink.
 * @param {string} rawUrl - The destination product/store URL.
 * @param {string} apiKey - The Cuelinks V3 API token.
 * @param {string} [subid] - Optional sub-ID tracking parameter.
 * @returns {Promise<string>} The converted short affiliate URL or original URL on error.
 */
async function convertCuelinks(rawUrl, apiKey, subid = 'wabot') {
    if (!apiKey || !rawUrl) return rawUrl;

    try {
        const response = await axios.post(
            CUELINKS_API_ENDPOINT,
            {
                url: rawUrl,
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
            return data.short_url || data.shorten_url || data.affiliate_url || data.tracking_url || rawUrl;
        }
        return rawUrl;
    } catch (err) {
        console.error(`⚠️ Cuelinks conversion failed for (${rawUrl}):`, err.response?.status, err.message);
        return rawUrl;
    }
}

module.exports = {
    CUELINKS_API_ENDPOINT,
    convertCuelinks
};
