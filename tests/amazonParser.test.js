const { convertAmazonLink, processMessageContent } = require('../src/amazonParser');

// We mock axios for testing shortlink expansion without hitting real network if we want,
// but for these tests, we will focus on the regex matching and replacement logic.
// Jest handles mocking easily if needed in the future.

describe('Amazon URL Parser Logic', () => {
    const mockTag = 'techstor0caaf-21';
    const mockDomain = 'amazon.in';

    test('Standard ASIN extraction /dp/ASIN', async () => {
        const rawUrl = 'https://www.amazon.in/dp/B0H1WVW8VY?tag=oldtag-21';
        const result = await convertAmazonLink(rawUrl, mockTag, mockDomain);
        expect(result).toBe('https://www.amazon.in/dp/B0H1WVW8VY?tag=techstor0caaf-21');
    });

    test('Product ASIN extraction /gp/product/ASIN', async () => {
        const rawUrl = 'https://www.amazon.in/gp/product/B0H1WVW8VY?smid=A1X';
        const result = await convertAmazonLink(rawUrl, mockTag, mockDomain);
        expect(result).toBe('https://www.amazon.in/dp/B0H1WVW8VY?tag=techstor0caaf-21');
    });

    test('Mobile ASIN extraction /gp/aw/d/ASIN', async () => {
        const rawUrl = 'https://www.amazon.in/gp/aw/d/B0H1WVW8VY';
        const result = await convertAmazonLink(rawUrl, mockTag, mockDomain);
        expect(result).toBe('https://www.amazon.in/dp/B0H1WVW8VY?tag=techstor0caaf-21');
    });

    test('Skip replacement if tag is already our tag', async () => {
        const rawUrl = 'https://www.amazon.in/dp/B0H1WVW8VY?tag=techstor0caaf-21';
        const result = await convertAmazonLink(rawUrl, mockTag, mockDomain);
        expect(result).toBe(rawUrl);
    });

    test('processMessageContent replaces links within text', async () => {
        const message = 'Check out this awesome deal! https://www.amazon.in/dp/B0H1WVW8VY?tag=old-21 Buy now!';
        const expected = 'Check out this awesome deal! https://www.amazon.in/dp/B0H1WVW8VY?tag=techstor0caaf-21 Buy now!';
        const result = await processMessageContent(message, mockTag, mockDomain);
        expect(result).toBe(expected);
    });
});
