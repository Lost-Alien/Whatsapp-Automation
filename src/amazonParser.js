const axios = require('axios');

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

    return finalUrl;
}

async function processMessageContent(body, newTag, amazonDomain) {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const matches = body.match(urlRegex);

    if (!matches || matches.length === 0) return body;

    let updatedText = body;

    for (const link of matches) {
        if (
            link.includes('amazon') ||
            link.includes('amzn.to') ||
            link.includes('amzn.eu') ||
            link.includes('link.amazon') ||
            link.includes('amzaff.to')
        ) {
            const convertedLink = await convertAmazonLink(link, newTag, amazonDomain);
            updatedText = updatedText.replace(link, convertedLink);
        }
    }

    return updatedText;
}

module.exports = {
    expandShortUrl,
    convertAmazonLink,
    processMessageContent
};
