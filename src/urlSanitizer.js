const { URL } = require('url');

function sanitizeAmazonUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return rawUrl;

    // 1. Fix double-? malformation: replace second ? with &
    let url = rawUrl.replace(/(\?[^?]*)(\?)/, '$1&');

    // Remove fragments
    url = url.split('#')[0];

    try {
        // 2. Parse and rebuild with only essential params (tag)
        const parsed = new URL(url);
        
        // Handle duplicate tag params automatically by getting the last one
        const allTags = parsed.searchParams.getAll('tag');
        const tag = allTags.length > 0 ? allTags[allTags.length - 1] : null;
        
        // Extract ASIN globally from the URL
        const generalAsinMatch = url.match(/(?:\/dp\/|\/gp\/product\/|\/gp\/aw\/d\/|\/o\/|\/product\/|\/ASIN\/|[?&]asin=)([a-zA-Z0-9]{10})/i);
        let asin = null;
        if (generalAsinMatch && generalAsinMatch[1]) {
            asin = generalAsinMatch[1];
        }

        let hostname = parsed.hostname.replace(/^www\./, '');
        // For link.amazon, it's a short link but if it has a tag, we might want to preserve it, though link.amazon doesn't usually have an ASIN directly visible in a 10 char format unless it's full. 
        // We will just rebuild if ASIN is found.
        
        if (asin) {
            // For amzn.to and link.amazon, they don't have ASINs directly, they have 9-char hashes usually. So generalAsinMatch won't match 10-char ASIN for them.
            // If it's a real ASIN, build clean URL.
            return `https://www.${hostname === 'amazon.com' || hostname.startsWith('amazon.') ? hostname : 'amazon.in'}/dp/${asin}${tag ? '?tag=' + tag : ''}`;
        }

        // Fallback: no ASIN, just return the URL with fixed double-? and fragments removed.
        // If there are duplicate tags, convertAmazonLink will replace them anyway since it uses a regex /tag=[...]/g
        return url;
    } catch (err) {
        // If URL parsing fails, return original
        return url;
    }
}

module.exports = {
    sanitizeAmazonUrl
};
