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

describe('Cuelinks Link Converter & Fallback Engine Logic', () => {
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
        const rawUrl = 'https://www.flipkart.com/item/123';
        const fallback = buildCuelinksFallbackUrl(rawUrl, DEFAULT_CHANNEL_ID, 'wabot');
        expect(fallback).toBe('https://linksredirect.com/?cid=311305&subid1=wabot&source=api&url=https%3A%2F%2Fwww.flipkart.com%2Fitem%2F123');
    });

    test('Uses direct fallback redirect URL if API key is missing', async () => {
        const rawUrl = 'https://www.flipkart.com/product/123';
        const result = await convertCuelinks(rawUrl, null, DEFAULT_CHANNEL_ID);
        expect(result).toBe('https://linksredirect.com/?cid=311305&subid1=wabot&source=api&url=https%3A%2F%2Fwww.flipkart.com%2Fproduct%2F123');
        expect(axios.post).not.toHaveBeenCalled();
    });

    test('Converts Flipkart URL with Cuelinks short_url and channel_id 311305', async () => {
        const rawUrl = 'https://www.flipkart.com/apple-iphone-15-black-128-gb/p/itm6ac6485515ae4';
        axios.post.mockResolvedValueOnce({
            data: {
                data: {
                    original_url: rawUrl,
                    short_url: 'https://fkrt.clnk.in/BWiE',
                    affiliate_url: 'https://linksredirect.com/?cid=311305&source=api&url=...'
                }
            }
        });

        const result = await convertCuelinks(rawUrl, mockApiKey, DEFAULT_CHANNEL_ID);
        expect(result).toBe('https://fkrt.clnk.in/BWiE');
        expect(axios.post).toHaveBeenCalledWith(
            CUELINKS_API_ENDPOINT,
            {
                url: rawUrl,
                channel_id: 311305,
                shorten: true,
                subid1: 'wabot'
            },
            {
                headers: {
                    'Authorization': `Token ${mockApiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: 8000
            }
        );
    });

    test('Unwraps competitor Cuelinks redirect and re-converts with our channel_id', async () => {
        const competitorRedirect = 'https://linksredirect.com/?cid=88888&source=api&url=https%3A%2F%2Fwww.ajio.com%2Fshoes%2F123';
        axios.post.mockResolvedValueOnce({
            data: {
                data: {
                    short_url: 'https://ajo.clnk.in/BWhU'
                }
            }
        });

        const result = await convertCuelinks(competitorRedirect, mockApiKey, DEFAULT_CHANNEL_ID);
        expect(result).toBe('https://ajo.clnk.in/BWhU');
        expect(axios.post).toHaveBeenCalledWith(
            CUELINKS_API_ENDPOINT,
            expect.objectContaining({
                url: 'https://www.ajio.com/shoes/123',
                channel_id: 311305
            }),
            expect.any(Object)
        );
    });

    test('Falls back to direct Cuelinks URL with cid=311305 on network error or timeout', async () => {
        const rawUrl = 'https://www.tatacliq.com/product/456';
        axios.post.mockRejectedValueOnce(new Error('Network Timeout'));

        const result = await convertCuelinks(rawUrl, mockApiKey, DEFAULT_CHANNEL_ID);
        expect(result).toBe('https://linksredirect.com/?cid=311305&subid1=wabot&source=api&url=https%3A%2F%2Fwww.tatacliq.com%2Fproduct%2F456');
    });

    // 20 Iteration Test Suite for Cuelinks Link Transformations & Channel ID Attribution
    describe('20-Iteration Reliability Tests across merchants with TechSelect CID (311305)', () => {
        const merchants = [
            { name: 'Flipkart', url: 'https://www.flipkart.com/item-', shortPrefix: 'https://fkrt.clnk.in/' },
            { name: 'Myntra', url: 'https://www.myntra.com/item-', shortPrefix: 'https://myntr.clnk.in/' },
            { name: 'Ajio', url: 'https://www.ajio.com/item-', shortPrefix: 'https://ajo.clnk.in/' },
            { name: 'TataCliq', url: 'https://www.tatacliq.com/item-', shortPrefix: 'https://clnk.in/' },
            { name: 'Croma', url: 'https://www.croma.com/item-', shortPrefix: 'https://crma.clnk.in/' },
            { name: 'Nykaa', url: 'https://www.nykaa.com/item-', shortPrefix: 'https://clnk.in/' }
        ];

        for (let i = 1; i <= 20; i++) {
            test(`Iteration ${i}/20: Converts merchant URLs correctly with channel_id 311305`, async () => {
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
