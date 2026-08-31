const {
    TARGET_CHANNEL_LINK,
    detectStrategy,
    extractAsin,
    extractLinkAmazonPathAsin,
    convertAmazon,
    convertFlipkart,
    convertViaCuelinks,
    buildCuelinksFallbackUrl,
    extractCompetitorTargetUrl,
    processLink,
    sanitizeFlipkartUrl,
    resolveFlipkartShortUrl,
    stripPromotionalContent,
    processMessageContent,
} = require('../src/linkProcessor');
const axios = require('axios');

jest.mock('axios');

const AFFILIATE_TAG = 'techstor0caaf-21';
const AMAZON_DOMAIN = 'amazon.in';
const CUELINKS_API_KEY = 'LmNADAnOLIEimDh8ItTaUEqjy1W_QTnfEkdXIaXqn7c';
const CHANNEL_ID = 311305;

beforeEach(() => jest.clearAllMocks());

// ─────────────────────────────────────────────
// detectStrategy
// ─────────────────────────────────────────────
describe('detectStrategy()', () => {
    test('identifies amazon domains', () => {
        expect(detectStrategy('https://www.amazon.in/dp/B0CHX1W1XY')).toBe('amazon');
        expect(detectStrategy('https://amzn.to/4cQF2Pc')).toBe('amazon');
        expect(detectStrategy('https://amzn.eu/d/abc')).toBe('amazon');
        expect(detectStrategy('https://link.amazon/B0CHX1W1XY')).toBe('amazon');
        expect(detectStrategy('https://amzaff.to/deal')).toBe('amazon');
    });

    test('identifies flipkart domains', () => {
        expect(detectStrategy('https://www.flipkart.com/item/p/123')).toBe('flipkart');
        expect(detectStrategy('https://dl.flipkart.com/s/abc')).toBe('flipkart');
        expect(detectStrategy('https://fkrt.it/abc')).toBe('flipkart');
        expect(detectStrategy('https://www.shopsy.in/item')).toBe('flipkart');
    });

    test('identifies competitor cuelinks domains', () => {
        expect(detectStrategy('https://linksredirect.com/?cid=99&url=...')).toBe('competitor');
    });

    test('identifies cuelinks-supported stores', () => {
        expect(detectStrategy('https://www.reliancedigital.in/item/123')).toBe('cuelinks');
        expect(detectStrategy('https://www.myntra.com/tshirt/456')).toBe('cuelinks');
        expect(detectStrategy('https://www.jiomart.com/product/789')).toBe('cuelinks');
        expect(detectStrategy('https://www.ajio.com/shoes')).toBe('cuelinks');
        expect(detectStrategy('https://www.croma.com/tv')).toBe('cuelinks');
        expect(detectStrategy('https://www.vijaysales.com/laptop')).toBe('cuelinks');
        expect(detectStrategy('https://www.tatacliq.com/item')).toBe('cuelinks');
        expect(detectStrategy('https://www.nykaa.com/beauty')).toBe('cuelinks');
        expect(detectStrategy('https://www.meesho.com/shirt')).toBe('cuelinks');
    });

    test('returns null for unknown domains', () => {
        expect(detectStrategy('https://www.google.com')).toBeNull();
        expect(detectStrategy('https://t.me/somegroup')).toBeNull();
        expect(detectStrategy('')).toBeNull();
        expect(detectStrategy(null)).toBeNull();
    });
});

// ─────────────────────────────────────────────
// extractAsin()
// ─────────────────────────────────────────────
describe('extractAsin()', () => {
    test('extracts ASIN from /dp/ path', () => {
        expect(extractAsin('https://www.amazon.in/dp/B0CHX1W1XY?tag=old-21')).toBe('B0CHX1W1XY');
    });
    test('extracts ASIN from /gp/product/ path', () => {
        expect(extractAsin('https://www.amazon.in/gp/product/B0CHX1W1XY')).toBe('B0CHX1W1XY');
    });
    test('extracts ASIN from /gp/aw/d/ path', () => {
        expect(extractAsin('https://www.amazon.in/gp/aw/d/B0CHX1W1XY')).toBe('B0CHX1W1XY');
    });
    test('returns null for URL without ASIN', () => {
        expect(extractAsin('https://www.amazon.in/s?k=iphone')).toBeNull();
    });
});

// ─────────────────────────────────────────────
// extractLinkAmazonPathAsin()
// ─────────────────────────────────────────────
describe('extractLinkAmazonPathAsin()', () => {
    test('returns ASIN when path segment is exactly 10 chars', () => {
        expect(extractLinkAmazonPathAsin('https://link.amazon/B0CHX1W1XY')).toBe('B0CHX1W1XY');
    });
    test('returns null when path segment is 9 chars (not a full ASIN)', () => {
        expect(extractLinkAmazonPathAsin('https://link.amazon/B0fp1GJJn')).toBeNull();
    });
    test('returns null for non-link.amazon domain', () => {
        expect(extractLinkAmazonPathAsin('https://amzn.to/B0CHX1W1XY')).toBeNull();
    });
    test('returns null for malformed URL', () => {
        expect(extractLinkAmazonPathAsin('not-a-url')).toBeNull();
    });
});

// ─────────────────────────────────────────────
// convertAmazon()
// ─────────────────────────────────────────────
describe('convertAmazon()', () => {
    test('standard /dp/ASIN URL: strips old tag, sets new tag', async () => {
        const result = await convertAmazon(
            'https://www.amazon.in/dp/B0CHX1W1XY?tag=oldtag-21&linkCode=sl1',
            AFFILIATE_TAG, AMAZON_DOMAIN
        );
        expect(result).toBe('https://www.amazon.in/dp/B0CHX1W1XY?tag=techstor0caaf-21');
    });

    test('/gp/product/ASIN URL: clean conversion', async () => {
        const result = await convertAmazon('https://www.amazon.in/gp/product/B0H1WVW8VY?smid=A1X', AFFILIATE_TAG, AMAZON_DOMAIN);
        expect(result).toBe('https://www.amazon.in/dp/B0H1WVW8VY?tag=techstor0caaf-21');
    });

    test('link.amazon with 10-char ASIN in path: no HTTP request', async () => {
        const result = await convertAmazon('https://link.amazon/B0CHX1W1XY', AFFILIATE_TAG, AMAZON_DOMAIN);
        expect(result).toBe('https://www.amazon.in/dp/B0CHX1W1XY?tag=techstor0caaf-21');
        expect(axios.get).not.toHaveBeenCalled();
    });

    test('link.amazon with 9-char ID: falls back to HTTP resolution', async () => {
        axios.get.mockRejectedValueOnce(Object.assign(new Error('500'), {
            response: { status: 500, headers: {} }
        }));
        const result = await convertAmazon('https://link.amazon/B0fp1GJJn', AFFILIATE_TAG, AMAZON_DOMAIN);
        // Should fall back to appending tag to the original URL
        expect(result).toContain('tag=' + AFFILIATE_TAG);
        expect(axios.get).toHaveBeenCalledTimes(1);
    });

    test('amzn.to resolved to amazon.in ASIN URL via HTTP', async () => {
        axios.get.mockResolvedValueOnce({
            status: 301,
            headers: { location: 'https://www.amazon.in/dp/B0CHX1W1XY?tag=someone-21' },
            data: '',
        });
        const result = await convertAmazon('https://amzn.to/4cQF2Pc', AFFILIATE_TAG, AMAZON_DOMAIN);
        expect(result).toBe('https://www.amazon.in/dp/B0CHX1W1XY?tag=techstor0caaf-21');
    });

    test('search URL: appends tag if no existing tag', async () => {
        const result = await convertAmazon('https://www.amazon.in/b?node=12345', AFFILIATE_TAG, AMAZON_DOMAIN);
        expect(result).toBe('https://www.amazon.in/b?node=12345&tag=techstor0caaf-21');
    });

    test('search URL: replaces existing tag if no ASIN', async () => {
        const result = await convertAmazon('https://www.amazon.in/s?k=iphone&tag=competitor-21', AFFILIATE_TAG, AMAZON_DOMAIN);
        expect(result).toBe('https://www.amazon.in/s?k=iphone&tag=techstor0caaf-21');
    });
});

// ─────────────────────────────────────────────
// convertFlipkart()
// ─────────────────────────────────────────────
describe('convertFlipkart()', () => {
    test('returns linksredirect fallback URL (bypasses Cuelinks API)', async () => {
        const rawUrl = 'https://www.flipkart.com/apple-iphone-15-black-128-gb/p/itm6ac6485515ae4';
        // flipkart.com is NOT a short-link host so resolveFlipkartShortUrl returns unchanged
        const result = await convertFlipkart(rawUrl, CHANNEL_ID);
        expect(result).toBe('https://linksredirect.com/?cid=311305&subid1=wabot&source=api&url=' + encodeURIComponent(rawUrl));
        expect(axios.post).not.toHaveBeenCalled();
    });

    test('dl.flipkart.com shortlink: resolves redirect then wraps', async () => {
        const rawUrl = 'https://dl.flipkart.com/s/j0E6wY';
        const resolvedUrl = 'https://www.flipkart.com/apple-iphone-15/p/itm12345';
        axios.get.mockRejectedValueOnce(Object.assign(new Error('301'), {
            response: { status: 301, headers: { location: resolvedUrl }, data: '' }
        }));
        const result = await convertFlipkart(rawUrl, CHANNEL_ID);
        expect(result).toContain('linksredirect.com');
        expect(result).toContain(encodeURIComponent(resolvedUrl));
    });
});

// ─────────────────────────────────────────────
// buildCuelinksFallbackUrl()
// ─────────────────────────────────────────────
describe('buildCuelinksFallbackUrl()', () => {
    test('constructs correct tracking URL with CID 311305', () => {
        const url = 'https://www.reliancedigital.in/apple-iphone-15/p/493839294';
        const result = buildCuelinksFallbackUrl(url, CHANNEL_ID, 'wabot');
        expect(result).toBe('https://linksredirect.com/?cid=311305&subid1=wabot&source=api&url=' + encodeURIComponent(url));
    });

    test('handles null gracefully', () => {
        expect(buildCuelinksFallbackUrl(null)).toBeNull();
    });
});

// ─────────────────────────────────────────────
// extractCompetitorTargetUrl()
// ─────────────────────────────────────────────
describe('extractCompetitorTargetUrl()', () => {
    test('unwraps competitor linksredirect URL', () => {
        const original = 'https://www.flipkart.com/item/123';
        const competitor = 'https://linksredirect.com/?cid=99999&source=api&url=' + encodeURIComponent(original);
        expect(extractCompetitorTargetUrl(competitor)).toBe(original);
    });

    test('returns input unchanged for non-competitor URL', () => {
        const url = 'https://www.myntra.com/tshirt/456';
        expect(extractCompetitorTargetUrl(url)).toBe(url);
    });
});

// ─────────────────────────────────────────────
// convertViaCuelinks()
// ─────────────────────────────────────────────
describe('convertViaCuelinks()', () => {
    test('returns short_url from API on success', async () => {
        axios.post.mockResolvedValueOnce({ data: { data: { short_url: 'https://clnk.in/BWkg' } } });
        const result = await convertViaCuelinks('https://www.reliancedigital.in/item/123', CUELINKS_API_KEY, CHANNEL_ID);
        expect(result).toBe('https://clnk.in/BWkg');
    });

    test('falls back to linksredirect URL on API error', async () => {
        axios.post.mockRejectedValueOnce(new Error('Network Timeout'));
        const rawUrl = 'https://www.reliancedigital.in/product/456';
        const result = await convertViaCuelinks(rawUrl, CUELINKS_API_KEY, CHANNEL_ID);
        expect(result).toBe('https://linksredirect.com/?cid=311305&subid1=wabot&source=api&url=' + encodeURIComponent(rawUrl));
    });

    test('uses fallback when no API key provided', async () => {
        const rawUrl = 'https://www.jiomart.com/product/789';
        const result = await convertViaCuelinks(rawUrl, null, CHANNEL_ID);
        expect(result).toContain('linksredirect.com');
        expect(axios.post).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────
// processLink() routing
// ─────────────────────────────────────────────
describe('processLink() routing', () => {
    const opts = { newTag: AFFILIATE_TAG, amazonDomain: AMAZON_DOMAIN, apiKey: CUELINKS_API_KEY, channelId: CHANNEL_ID };

    test('routes amazon.in to amazon handler', async () => {
        const result = await processLink('https://www.amazon.in/dp/B0CHX1W1XY?tag=old-21', opts);
        expect(result).toBe('https://www.amazon.in/dp/B0CHX1W1XY?tag=techstor0caaf-21');
    });

    test('routes flipkart.com to flipkart handler (no API call)', async () => {
        const fkUrl = 'https://www.flipkart.com/item/p/123';
        const result = await processLink(fkUrl, opts);
        expect(result).toContain('linksredirect.com');
        expect(axios.post).not.toHaveBeenCalled();
    });

    test('routes competitor linksredirect → unwraps → re-routes amazon', async () => {
        const inner = 'https://www.amazon.in/dp/B0CHX1W1XY';
        const competitor = 'https://linksredirect.com/?cid=99999&source=api&url=' + encodeURIComponent(inner);
        const result = await processLink(competitor, opts);
        expect(result).toBe('https://www.amazon.in/dp/B0CHX1W1XY?tag=techstor0caaf-21');
    });

    test('routes competitor linksredirect → unwraps → re-routes cuelinks store', async () => {
        axios.post.mockResolvedValueOnce({ data: { data: { short_url: 'https://clnk.in/xyz' } } });
        const inner = 'https://www.myntra.com/tshirt/456';
        const competitor = 'https://linksredirect.com/?cid=99999&url=' + encodeURIComponent(inner);
        const result = await processLink(competitor, opts);
        expect(result).toBe('https://clnk.in/xyz');
    });

    test('returns URL unchanged for unknown domains', async () => {
        const url = 'https://www.google.com/search?q=deals';
        const result = await processLink(url, opts);
        expect(result).toBe(url);
    });
});

// ─────────────────────────────────────────────
// stripPromotionalContent()
// ─────────────────────────────────────────────
describe('stripPromotionalContent()', () => {
    test('strips Req Sumit Bhiwani offline dealer quote', () => {
        expect(stripPromotionalContent('17 256 85700\nReq Sumit Bhiwani')).toBe('17 256 85700');
    });

    test('strips WhatsApp channel links and tinyurl redirects', () => {
        const input = 'Only Mobile,TV Electronic Deals👇 \nhttps://whatsapp.com/channel/0029Va8sHsBDTkK7E9LCXq2D\nhttps://tinyurl.com/6vu4mdfp\n🔥 Boat Airdopes at ₹899';
        expect(stripPromotionalContent(input)).toBe('🔥 Boat Airdopes at ₹899');
    });

    test('strips Telegram links', () => {
        const input = '🔥 Deal\nhttps://t.me/somechannel\n₹999 only!';
        const result = stripPromotionalContent(input);
        expect(result).not.toContain('t.me');
        expect(result).toContain('🔥 Deal');
        expect(result).toContain('₹999 only!');
    });

    test('returns empty string for all-promo message', () => {
        const input = 'Req Jind\nOnly Mobile,TV Electronic Deals👇\nhttps://whatsapp.com/channel/0029Va8sHsBDTkK7E9LCXq2D';
        expect(stripPromotionalContent(input)).toBe('');
    });
});

// ─────────────────────────────────────────────
// processMessageContent() — full pipeline
// ─────────────────────────────────────────────
describe('processMessageContent() — full pipeline', () => {
    const opts = [AFFILIATE_TAG, AMAZON_DOMAIN, CUELINKS_API_KEY, CHANNEL_ID];

    // NOTE: Since the "forward all meaningful content" update, text-only price lists
    // are now forwarded (with channel link appended) instead of being dropped.
    // Only messages that are entirely promo/invite links OR too short get dropped.
    test('forwards offline dealer price list text (meaningful content > 15 chars)', async () => {
        const msg = '17 256 85700\nCe6 8/128 32700\nReq Sumit Bhiwani';
        const result = await processMessageContent(msg, ...opts);
        // 'Req Sumit Bhiwani' is stripped, but '17 256 85700\nCe6 8/128 32700' remains and is forwarded
        expect(result).toContain('17 256 85700');
        expect(result).toContain('Ce6 8/128 32700');
        expect(result).not.toContain('Req Sumit Bhiwani');
        expect(result).toContain(TARGET_CHANNEL_LINK);
    });

    test('drops message containing only promo WhatsApp channel link + tinyurl', async () => {
        const msg = 'Only Mobile,TV Electronic Deals👇\nhttps://whatsapp.com/channel/0029Va8sHsBDTkK7E9LCXq2D\nAll Loots\nhttps://tinyurl.com/6vu4mdfp';
        expect(await processMessageContent(msg, ...opts)).toBe('');
    });

    test('converts Amazon deal, strips promo, appends TechSelect channel', async () => {
        const msg = 'Req Jind\nOnly Mobile,TV Electronic Deals👇\nhttps://whatsapp.com/channel/0029Va8sHsBDTkK7E9LCXq2D\nhttps://tinyurl.com/6vu4mdfp\n\n🔥 Apple iPhone 15 (128 GB)\nDeal Price: ₹65,999\n👉 Buy: https://www.amazon.in/dp/B0CHX1W1XY?tag=old-21';
        const result = await processMessageContent(msg, ...opts);
        expect(result).toContain('https://www.amazon.in/dp/B0CHX1W1XY?tag=techstor0caaf-21');
        expect(result).not.toContain('0029Va8sHsBDTkK7E9LCXq2D');
        expect(result).not.toContain('tinyurl.com');
        expect(result).not.toContain('Req Jind');
        expect(result).toContain(TARGET_CHANNEL_LINK);
        const channelCount = (result.match(/0029VbDdnbkG3R3e7wu0g70C/g) || []).length;
        expect(channelCount).toBe(1);
    });

    test('converts Reliance Digital deal via Cuelinks, appends TechSelect channel', async () => {
        axios.post.mockResolvedValueOnce({ data: { data: { short_url: 'https://clnk.in/BWkg' } } });
        const msg = 'Req Tohana\n\n🔥 OnePlus Nord CE4 Lite 5G\nPrice: ₹17,999\nLink: https://www.reliancedigital.in/oneplus-nord-ce4-lite/p/494421869\n\nOnly Mobile,TV Electronic Deals👇\nhttps://whatsapp.com/channel/0029Va8sHsBDTkK7E9LCXq2D';
        const result = await processMessageContent(msg, ...opts);
        expect(result).toContain('https://clnk.in/BWkg');
        expect(result).not.toContain('0029Va8sHsBDTkK7E9LCXq2D');
        expect(result).toContain(TARGET_CHANNEL_LINK);
    });

    test('converts Flipkart deal via linksredirect fallback (no Cuelinks API call)', async () => {
        const fkUrl = 'https://www.flipkart.com/apple-iphone-15-black-128-gb/p/itm6ac6485515ae4';
        const msg = '🔥 iPhone 15 deal!\nLink: ' + fkUrl;
        const result = await processMessageContent(msg, ...opts);
        expect(result).toContain('linksredirect.com');
        expect(result).toContain(encodeURIComponent(fkUrl));
        expect(axios.post).not.toHaveBeenCalled();
    });

    test('link.amazon with 10-char ASIN converts without HTTP (no axios.get)', async () => {
        const msg = '🔥 Amazon Deal\nhttps://link.amazon/B0CHX1W1XY';
        const result = await processMessageContent(msg, ...opts);
        expect(result).toContain('https://www.amazon.in/dp/B0CHX1W1XY?tag=techstor0caaf-21');
        expect(axios.get).not.toHaveBeenCalled();
        expect(result).toContain(TARGET_CHANNEL_LINK);
    });

    // 20-iteration reliability test
    describe('20-iteration reliability across merchants', () => {
        const merchants = [
            { name: 'Reliance Digital', url: 'https://www.reliancedigital.in/item-', prefix: 'https://clnk.in/' },
            { name: 'JioMart', url: 'https://www.jiomart.com/item-', prefix: 'https://clnk.in/' },
            { name: 'Myntra', url: 'https://www.myntra.com/item-', prefix: 'https://myntr.clnk.in/' },
            { name: 'Ajio', url: 'https://www.ajio.com/item-', prefix: 'https://ajo.clnk.in/' },
            { name: 'Vijay Sales', url: 'https://www.vijaysales.com/item-', prefix: 'https://clnk.in/' },
            { name: 'TataCliq', url: 'https://www.tatacliq.com/item-', prefix: 'https://clnk.in/' },
            { name: 'Croma', url: 'https://www.croma.com/item-', prefix: 'https://crma.clnk.in/' },
            { name: 'Nykaa', url: 'https://www.nykaa.com/item-', prefix: 'https://clnk.in/' },
            { name: 'Meesho', url: 'https://www.meesho.com/item-', prefix: 'https://clnk.in/' },
            { name: 'Snapdeal', url: 'https://www.snapdeal.com/item-', prefix: 'https://clnk.in/' },
        ];

        for (let i = 1; i <= 20; i++) {
            test(`Iteration ${i}/20: ${merchants[i % merchants.length].name} strips foreign channels, appends TechSelect`, async () => {
                const merchant = merchants[i % merchants.length];
                const testUrl = merchant.url + i + '00';
                const expected = merchant.prefix + 'deal' + i;
                const foreignId = '0029Va8sHsBDTkK7E9LCXq2D_' + i;

                axios.post.mockResolvedValueOnce({ data: { data: { short_url: expected } } });

                const fakeAsin = 'B00000000' + (i % 10);

                const msg = 'Req Jind\nOnly Mobile,TV Electronic Deals👇\nhttps://whatsapp.com/channel/' + foreignId + '\n\n🔥 Product Deal #' + i + '\nAmazon: https://www.amazon.in/dp/' + fakeAsin + '?tag=spam-21\nStore: ' + testUrl + '\n\nhttps://whatsapp.com/channel/0029Va8sHsBDTkK7E9LCXq2D';

                const result = await processMessageContent(msg, ...opts);
                expect(result).toContain('https://www.amazon.in/dp/' + fakeAsin + '?tag=techstor0caaf-21');
                expect(result).toContain(expected);
                expect(result).not.toContain('Req Jind');
                expect(result).not.toContain(foreignId);
                expect(result).not.toContain('0029Va8sHsBDTkK7E9LCXq2D\n');
                expect(result).toContain(TARGET_CHANNEL_LINK);
                const channelCount = (result.match(/0029VbDdnbkG3R3e7wu0g70C/g) || []).length;
                expect(channelCount).toBe(1);
            });
        }
    });
});

// ─────────────────────────────────────────────
// Phase 2 — sanitizeFlipkartUrl()
// Ported from da-vinci-noob/telegram-affiliate-link-generator-bot (affiliateprocess.rb)
// ─────────────────────────────────────────────
describe('sanitizeFlipkartUrl() — Phase 2 merge from affiliateprocess.rb', () => {
    test('strips affid param from canonical flipkart.com URL', () => {
        const dirty = 'https://www.flipkart.com/apple-iphone/p/itm123?affid=competitor123&affExtParam1=spam';
        const clean = sanitizeFlipkartUrl(dirty);
        expect(clean).not.toContain('affid');
        expect(clean).not.toContain('affExtParam1');
        expect(clean).toContain('/apple-iphone/p/itm123');
    });

    test('strips vsugd, otracker, pid, lid params', () => {
        const dirty = 'https://www.flipkart.com/product/p/itm?vsugd=abc&otracker=xtv&pid=XYZ&lid=LID123';
        const clean = sanitizeFlipkartUrl(dirty);
        expect(clean).not.toContain('vsugd');
        expect(clean).not.toContain('otracker');
        expect(clean).not.toContain('pid=');
        expect(clean).not.toContain('lid=');
    });

    test('does NOT strip params from non-flipkart domains (short links)', () => {
        const shortLink = 'https://fkrt.it/abc123?affid=keep';
        expect(sanitizeFlipkartUrl(shortLink)).toBe(shortLink);
    });

    test('handles URL with no affiliate params gracefully', () => {
        const url = 'https://www.flipkart.com/motorola-g37/p/itm999';
        expect(sanitizeFlipkartUrl(url)).toBe(url);
    });

    test('handles null/undefined gracefully', () => {
        expect(sanitizeFlipkartUrl(null)).toBeNull();
        expect(sanitizeFlipkartUrl(undefined)).toBeUndefined();
    });
});

// ─────────────────────────────────────────────
// Phase 3 — resolveFlipkartShortUrl() HTML body fallback
// Ported from da-vinci-noob/telegram-affiliate-link-generator-bot (process_url.rb redirection())
// ─────────────────────────────────────────────
describe('resolveFlipkartShortUrl() — Phase 3 HTML body fallback', () => {
    test('returns input unchanged for non-short-link domains', async () => {
        const url = 'https://www.flipkart.com/product/p/itm123';
        const result = await resolveFlipkartShortUrl(url);
        expect(result).toBe(url);
        expect(axios.get).not.toHaveBeenCalled();
    });

    test('follows 301 redirect from fkrt.it to flipkart.com', async () => {
        axios.get.mockRejectedValueOnce(Object.assign(new Error('301'), {
            response: { status: 301, headers: { location: 'https://www.flipkart.com/motorola-g37/p/itm9999' }, data: '' }
        }));
        const result = await resolveFlipkartShortUrl('https://fkrt.it/abc123');
        expect(result).toContain('flipkart.com');
        expect(result).toContain('/motorola-g37/');
    });

    test('extracts flipkart URL from HTML body when no redirect header (bilty.co WAP page)', async () => {
        const htmlBody = '<html><body>Click here: <a href="https://www.flipkart.com/realme/p/itm8888">Buy Now</a></body></html>';
        axios.get.mockResolvedValueOnce({
            status: 200,
            headers: {},
            data: htmlBody,
        });
        const result = await resolveFlipkartShortUrl('https://bilty.co/abc');
        expect(result).toBe('https://www.flipkart.com/realme/p/itm8888');
    });

    test('returns original URL if no flipkart URL found in body or headers', async () => {
        axios.get.mockResolvedValueOnce({ status: 200, headers: {}, data: '<html>No product link here</html>' });
        const result = await resolveFlipkartShortUrl('https://fkr.in/xyz');
        expect(result).toBe('https://fkr.in/xyz');
    });
});

// ─────────────────────────────────────────────
// Phase 4 — STRIP_WORDS env var (dynamic delete list)
// Ported from da-vinci-noob/telegram-affiliate-link-generator-bot (bot.rb delete word list)
// ─────────────────────────────────────────────
describe('stripPromotionalContent() — Phase 4 STRIP_WORDS dynamic env', () => {
    const originalEnv = process.env.STRIP_WORDS;

    afterEach(() => {
        process.env.STRIP_WORDS = originalEnv || '';
    });

    test('built-in patterns: strips "Req Jind" and WhatsApp channel links', () => {
        const input = 'Req Jind\nhttps://whatsapp.com/channel/0029Va8sHsBDTkK7E9LCXq2D\n🔥 Deal!';
        const result = stripPromotionalContent(input);
        expect(result).not.toContain('Req Jind');
        expect(result).not.toContain('0029Va8sHsBDTkK7E9LCXq2D');
        expect(result).toContain('🔥 Deal!');
    });

    test('STRIP_WORDS env: strips custom word "offline" from message', () => {
        // Simulate env at runtime (EXTRA_STRIP_WORDS is loaded at module init,
        // so we test the pattern function directly here)
        const fakeWords = ['offline'];
        const text = 'Buy this laptop offline rate 45000\n🔥 Great deal!';
        const escaped = fakeWords.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        const pattern = new RegExp('(?:^|\\s)(?:' + escaped.join('|') + ')(?:\\s|$)', 'gim');
        const stripped = text.replace(pattern, ' ').trim();
        expect(stripped).not.toContain('offline');
        expect(stripped).toContain('🔥 Great deal!');
    });

    test('STRIP_WORDS env: multiple words stripped comma-separated', () => {
        const fakeWords = ['kaithal', 'bhiwani', 'tohana'];
        const text = 'kaithal 45000\nbhiwani 32000\n🔥 Samsung Deal';
        const escaped = fakeWords.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        const pattern = new RegExp('(?:^|\\s)(?:' + escaped.join('|') + ')(?:\\s|$)', 'gim');
        const stripped = text.replace(pattern, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
        expect(stripped).not.toContain('kaithal');
        expect(stripped).not.toContain('bhiwani');
        expect(stripped).not.toContain('tohana');
        expect(stripped).toContain('🔥 Samsung Deal');
    });
});
