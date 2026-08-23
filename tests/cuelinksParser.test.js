const { 
    convertCuelinks, 
    CUELINKS_API_ENDPOINT, 
    DEFAULT_CHANNEL_ID,
    extractTargetUrl,
    buildCuelinksFallbackUrl,
    expandNonAmazonShortUrl
} = require('../src/cuelinksParser');
const axios = require('axios');

jest.mock('axios');

describe('Cuelinks Link Converter & Multi-Store Engine Logic', () => {
    const mockApiKey = 'LmNADAnOLIEimDh8ItTaUEqjy1W_QTnfEkdXIaXqn7c';

    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('extractTargetUrl unwraps competitor Cuelinks / linksredirect URLs', () => {
        const competitorUrl = 'https://linksredirect.com/?cid=99999&source=api&url=https%3A%2F%2Fwww.flipkart.com%2Fitem%2F123';
        const unwrapped = extractTargetUrl(competitorUrl);
        expect(unwrapped).toBe('https://www.flipkart.com/item/123');

        const normalUrl = 'https://www.myntra.com/tshirt/456';
        expect(extractTargetUrl(normalUrl)).toBe(normalUrl);
    });

    test('buildCuelinksFallbackUrl constructs valid tracking URL with TechSelect Channel ID (311305)', () => {
        const rawUrl = 'https://www.reliancedigital.in/apple-iphone-15-128-gb-blue/p/493839294';
        const fallback = buildCuelinksFallbackUrl(rawUrl, DEFAULT_CHANNEL_ID, 'wabot');
        expect(fallback).toBe('https://linksredirect.com/?cid=311305&subid1=wabot&source=api&url=https%3A%2F%2Fwww.reliancedigital.in%2Fapple-iphone-15-128-gb-blue%2Fp%2F493839294');
    });

    test('Converts Reliance Digital URL with Cuelinks short_url and channel_id 311305', async () => {
        const rawUrl = 'https://www.reliancedigital.in/apple-iphone-15-128-gb-blue/p/493839294';
        axios.post.mockResolvedValueOnce({
            data: {
                data: {
                    original_url: rawUrl,
                    short_url: 'https://clnk.in/BWkg',
                    campaign: { id: 3955, name: 'Reliance Digital' }
                }
            }
        });

        const result = await convertCuelinks(rawUrl, mockApiKey, DEFAULT_CHANNEL_ID);
        expect(result).toBe('https://clnk.in/BWkg');
        expect(axios.post).toHaveBeenCalledWith(
            CUELINKS_API_ENDPOINT,
            {
                url: rawUrl,
                channel_id: 311305,
                shorten: true,
                subid1: 'wabot'
            },
            expect.any(Object)
        );
    });

    test('Converts JioMart URL with Cuelinks short_url', async () => {
        const rawUrl = 'https://www.jiomart.com/p/electronics/apple-iphone-15-128-gb-blue/605489066';
        axios.post.mockResolvedValueOnce({
            data: {
                data: {
                    short_url: 'https://clnk.in/BWki',
                    campaign: { id: 4162, name: 'JioMart' }
                }
            }
        });

        const result = await convertCuelinks(rawUrl, mockApiKey, DEFAULT_CHANNEL_ID);
        expect(result).toBe('https://clnk.in/BWki');
    });

    test('Converts Vijay Sales URL with Cuelinks short_url', async () => {
        const rawUrl = 'https://www.vijaysales.com/apple-iphone-15-128-gb-blue/24183';
        axios.post.mockResolvedValueOnce({
            data: {
                data: {
                    short_url: 'https://clnk.in/BWkj',
                    campaign: { id: 4164, name: 'Vijay Sales' }
                }
            }
        });

        const result = await convertCuelinks(rawUrl, mockApiKey, DEFAULT_CHANNEL_ID);
        expect(result).toBe('https://clnk.in/BWkj');
    });

    test('Bypasses Cuelinks API for Flipkart URLs to avoid WAF block and returns fallback URL', async () => {
        const rawUrl = 'https://www.flipkart.com/apple-iphone-15-black-128-gb/p/itm6ac6485515ae4';

        const result = await convertCuelinks(rawUrl, mockApiKey, DEFAULT_CHANNEL_ID);
        expect(result).toBe('https://linksredirect.com/?cid=311305&subid1=wabot&source=api&url=https%3A%2F%2Fwww.flipkart.com%2Fapple-iphone-15-black-128-gb%2Fp%2Fitm6ac6485515ae4');
        expect(axios.post).not.toHaveBeenCalledWith(CUELINKS_API_ENDPOINT, expect.any(Object), expect.any(Object));
    });

    test('Falls back to direct Cuelinks URL with cid=311305 on network error or timeout', async () => {
        const rawUrl = 'https://www.reliancedigital.in/product/456';
        axios.post.mockRejectedValueOnce(new Error('Network Timeout'));

        const result = await convertCuelinks(rawUrl, mockApiKey, DEFAULT_CHANNEL_ID);
        expect(result).toBe('https://linksredirect.com/?cid=311305&subid1=wabot&source=api&url=https%3A%2F%2Fwww.reliancedigital.in%2Fproduct%2F456');
    });

    // 20 Iteration Test Suite across all merchants including Reliance Digital, JioMart, Vijay Sales
    describe('20-Iteration Reliability Tests across merchants with TechSelect CID (311305)', () => {
        const merchants = [
            { name: 'Reliance Digital', url: 'https://www.reliancedigital.in/item-', shortPrefix: 'https://clnk.in/' },
            { name: 'JioMart', url: 'https://www.jiomart.com/item-', shortPrefix: 'https://clnk.in/' },
            { name: 'Myntra', url: 'https://www.myntra.com/item-', shortPrefix: 'https://myntr.clnk.in/' },
            { name: 'Ajio', url: 'https://www.ajio.com/item-', shortPrefix: 'https://ajo.clnk.in/' },
            { name: 'Vijay Sales', url: 'https://www.vijaysales.com/item-', shortPrefix: 'https://clnk.in/' },
            { name: 'TataCliq', url: 'https://www.tatacliq.com/item-', shortPrefix: 'https://clnk.in/' },
            { name: 'Croma', url: 'https://www.croma.com/item-', shortPrefix: 'https://crma.clnk.in/' },
            { name: 'Nykaa', url: 'https://www.nykaa.com/item-', shortPrefix: 'https://clnk.in/' },
            { name: 'Shopsy', url: 'https://www.shopsy.in/item-', shortPrefix: 'https://clnk.in/' }
        ];

        for (let i = 1; i <= 20; i++) {
            test(`Iteration ${i}/20: Converts ${merchants[i % merchants.length].name} correctly with channel_id 311305`, async () => {
                const merchant = merchants[i % merchants.length];
                const testUrl = `${merchant.url}${i}00`;
                const expectedShort = `${merchant.shortPrefix}deal${i}`;

                axios.post.mockResolvedValueOnce({
                    data: {
                        data: {
                            short_url: expectedShort,
                            tracking_url: `https://linksredirect.com/?cid=311305&url=${encodeURIComponent(testUrl)}`
                        }
                    }
                });

                const res = await convertCuelinks(testUrl, mockApiKey, DEFAULT_CHANNEL_ID, `run_${i}`);
                expect(res).toBe(expectedShort);
            });
        }
    });
});
