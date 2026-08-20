const { convertCuelinks, CUELINKS_API_ENDPOINT } = require('../src/cuelinksParser');
const axios = require('axios');

jest.mock('axios');

describe('Cuelinks Link Converter Logic & Unit Tests', () => {
    const mockApiKey = 'LmNADAnOLIEimDh8ItTaUEqjy1W_QTnfEkdXIaXqn7c';

    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('Returns raw URL if API key is missing', async () => {
        const rawUrl = 'https://www.flipkart.com/product/123';
        const result = await convertCuelinks(rawUrl, null);
        expect(result).toBe(rawUrl);
        expect(axios.post).not.toHaveBeenCalled();
    });

    test('Converts Flipkart URL with Cuelinks short_url', async () => {
        const rawUrl = 'https://www.flipkart.com/apple-iphone-15-black-128-gb/p/itm6ac6485515ae4';
        axios.post.mockResolvedValueOnce({
            data: {
                data: {
                    original_url: rawUrl,
                    short_url: 'https://fkrt.clnk.in/BWhS',
                    affiliate_url: 'https://linksredirect.com/?cid=311288&url=...'
                }
            }
        });

        const result = await convertCuelinks(rawUrl, mockApiKey);
        expect(result).toBe('https://fkrt.clnk.in/BWhS');
        expect(axios.post).toHaveBeenCalledWith(
            CUELINKS_API_ENDPOINT,
            {
                url: rawUrl,
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

    test('Converts Myntra URL with Cuelinks short_url', async () => {
        const rawUrl = 'https://www.myntra.com/tshirts/roadster/2297184/buy';
        axios.post.mockResolvedValueOnce({
            data: {
                data: {
                    short_url: 'https://myntr.clnk.in/BWhT'
                }
            }
        });

        const result = await convertCuelinks(rawUrl, mockApiKey);
        expect(result).toBe('https://myntr.clnk.in/BWhT');
    });

    test('Falls back to affiliate_url or tracking_url if short_url is unavailable', async () => {
        const rawUrl = 'https://www.ajio.com/puma-shoes';
        axios.post.mockResolvedValueOnce({
            data: {
                data: {
                    affiliate_url: 'https://linksredirect.com/?cid=311288&url=ajio'
                }
            }
        });

        const result = await convertCuelinks(rawUrl, mockApiKey);
        expect(result).toBe('https://linksredirect.com/?cid=311288&url=ajio');
    });

    test('Gracefully returns raw URL on network error or timeout', async () => {
        const rawUrl = 'https://www.tatacliq.com/product/456';
        axios.post.mockRejectedValueOnce(new Error('Network Timeout'));

        const result = await convertCuelinks(rawUrl, mockApiKey);
        expect(result).toBe(rawUrl);
    });

    // 20 Iteration Test Suite for Cuelinks Link Transformations
    describe('20-Iteration Reliability Tests across merchants', () => {
        const merchants = [
            { name: 'Flipkart', url: 'https://www.flipkart.com/item-', shortPrefix: 'https://fkrt.clnk.in/' },
            { name: 'Myntra', url: 'https://www.myntra.com/item-', shortPrefix: 'https://myntr.clnk.in/' },
            { name: 'Ajio', url: 'https://www.ajio.com/item-', shortPrefix: 'https://ajo.clnk.in/' },
            { name: 'TataCliq', url: 'https://www.tatacliq.com/item-', shortPrefix: 'https://clnk.in/' },
            { name: 'Croma', url: 'https://www.croma.com/item-', shortPrefix: 'https://clnk.in/' },
            { name: 'Nykaa', url: 'https://www.nykaa.com/item-', shortPrefix: 'https://clnk.in/' }
        ];

        for (let i = 1; i <= 20; i++) {
            test(`Iteration ${i}/20: Converts merchant URLs correctly`, async () => {
                const merchant = merchants[i % merchants.length];
                const testUrl = `${merchant.url}${i}00`;
                const expectedShort = `${merchant.shortPrefix}deal${i}`;

                axios.post.mockResolvedValueOnce({
                    data: {
                        data: {
                            short_url: expectedShort
                        }
                    }
                });

                const res = await convertCuelinks(testUrl, mockApiKey, `test_run_${i}`);
                expect(res).toBe(expectedShort);
            });
        }
    });
});
