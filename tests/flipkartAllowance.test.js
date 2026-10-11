const {
    TARGET_CHANNEL_LINK,
    DEFAULT_CHANNEL_ID,
    detectStrategy,
    isFlipkartUrl,
    hasFlipkartLink,
    cleanTrailingPunctuation,
    convertFlipkart,
    buildCuelinksFallbackUrl,
    stripPromotionalContent,
    processMessageContent,
} = require('../src/linkProcessor');
const axios = require('axios');

jest.mock('axios');

const AFFILIATE_TAG = 'techstor0caaf-21';
const AMAZON_DOMAIN = 'amazon.in';
const CUELINKS_API_KEY = 'LmNADAnOLIEimDh8ItTaUEqjy1W_QTnfEkdXIaXqn7c';
const CHANNEL_ID = 311305;

beforeEach(() => {
    jest.clearAllMocks();
});

describe('Flipkart Link Processing & Allowance Rules', () => {
    const opts = [AFFILIATE_TAG, AMAZON_DOMAIN, CUELINKS_API_KEY, CHANNEL_ID];

    describe('Domain detection for all Flipkart shortener variants', () => {
        const variants = [
            'https://www.flipkart.com/apple-iphone-15/p/itm123',
            'https://dl.flipkart.com/s/xyz123',
            'https://shopsy.in/item/123',
            'https://fkrt.cc/zwQLO3F',
            'https://fkrt.to/deal99',
            'https://fkrt.it/abc123',
            'https://fkrt.co/xyz456',
            'https://fkrt.in/deal01',
            'https://fkrt.link/special',
            'https://fkrt.me/loot',
            'https://fkr.in/quick',
            'https://fkr.co/save',
            'https://fkr.cc/flash',
            'https://fkr.to/grab',
            'https://fkr.it/fast',
            'https://bilty.co/promo',
            'https://bilty.in/bargain',
        ];

        variants.forEach(url => {
            test(`detects ${url} as flipkart strategy`, () => {
                expect(detectStrategy(url)).toBe('flipkart');
                expect(isFlipkartUrl(url)).toBe(true);
            });
        });
    });

    describe('cleanTrailingPunctuation()', () => {
        test('removes trailing periods, commas, closing brackets and asterisks', () => {
            expect(cleanTrailingPunctuation('https://fkrt.cc/zwQLO3F.')).toBe('https://fkrt.cc/zwQLO3F');
            expect(cleanTrailingPunctuation('https://fkrt.cc/zwQLO3F,')).toBe('https://fkrt.cc/zwQLO3F');
            expect(cleanTrailingPunctuation('https://fkrt.cc/zwQLO3F)')).toBe('https://fkrt.cc/zwQLO3F');
            expect(cleanTrailingPunctuation('https://fkrt.cc/zwQLO3F*')).toBe('https://fkrt.cc/zwQLO3F');
            expect(cleanTrailingPunctuation('https://fkrt.cc/zwQLO3F')).toBe('https://fkrt.cc/zwQLO3F');
        });
    });

    describe('convertFlipkart() resilience', () => {
        test('wraps URL with Cuelinks fallback even if unshortening fails or times out', async () => {
            const rawUrl = 'https://fkrt.cc/zwQLO3F';
            axios.get.mockRejectedValueOnce(new Error('Connection timed out'));

            const result = await convertFlipkart(rawUrl, CHANNEL_ID);
            expect(result).toBe('https://linksredirect.com/?cid=311305&subid1=wabot&source=api&url=' + encodeURIComponent(rawUrl));
        });

        test('cleans trailing punctuation before wrapping', async () => {
            const rawUrl = 'https://fkrt.cc/zwQLO3F.';
            axios.get.mockRejectedValueOnce(new Error('404 Not Found'));

            const result = await convertFlipkart(rawUrl, CHANNEL_ID);
            expect(result).toBe('https://linksredirect.com/?cid=311305&subid1=wabot&source=api&url=' + encodeURIComponent('https://fkrt.cc/zwQLO3F'));
        });
    });

    describe('processMessageContent() with Flipkart links', () => {
        test('allows and forwards bare Flipkart link (< 15 chars) without dropping', async () => {
            const msg = 'https://fkrt.cc/zwQLO3F';
            const result = await processMessageContent(msg, ...opts);
            expect(result).toContain('linksredirect.com');
            expect(result).toContain(encodeURIComponent('https://fkrt.cc/zwQLO3F'));
            expect(result).toContain(TARGET_CHANNEL_LINK);
        });

        test('preserves Flipkart link on line starting with Req keyword', async () => {
            const msg = 'Req Loot https://fkrt.cc/zwQLO3F\nOffer price 999';
            const result = await processMessageContent(msg, ...opts);
            expect(result).toContain('linksredirect.com');
            expect(result).toContain(TARGET_CHANNEL_LINK);
            expect(result).not.toContain('Req Loot');
        });

        test('preserves Flipkart link on line starting with Join Deals phrase', async () => {
            const msg = 'Join Deals: https://fkrt.cc/zwQLO3F\nCheck price now';
            const result = await processMessageContent(msg, ...opts);
            expect(result).toContain('linksredirect.com');
            expect(result).toContain(TARGET_CHANNEL_LINK);
        });

        test('allows Flipkart link if promo stripping stripped to empty text', async () => {
            const msg = 'Req Jind\nhttps://whatsapp.com/channel/0029Va8sHsBDTkK7E9LCXq2D\nhttps://fkrt.cc/zwQLO3F';
            const result = await processMessageContent(msg, ...opts);
            expect(result).toContain('linksredirect.com');
            expect(result).toContain(TARGET_CHANNEL_LINK);
            expect(result).not.toContain('Req Jind');
            expect(result).not.toContain('0029Va8sHsBDTkK7E9LCXq2D');
        });
    });
});
