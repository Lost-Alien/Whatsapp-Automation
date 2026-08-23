const { 
    TARGET_CHANNEL_LINK,
    isAmazonUrl,
    convertAmazonLink, 
    stripPromotionalContent, 
    processMessageContent 
} = require('../src/amazonParser');
const { convertCuelinks } = require('../src/cuelinksParser');

jest.mock('../src/cuelinksParser');

describe('Amazon URL Parser Logic', () => {
    const affiliateTag = 'techstor0caaf-21';
    const mockDomain = 'amazon.in';

    test('Standard ASIN extraction /dp/ASIN (strips old tag and params)', async () => {
        const rawUrl = 'https://www.amazon.in/dp/B0H1WVW8VY?tag=oldtag-21&linkCode=sl1';
        const result = await convertAmazonLink(rawUrl, affiliateTag, mockDomain);
        expect(result).toBe('https://www.amazon.in/dp/B0H1WVW8VY?tag=techstor0caaf-21');
    });

    test('Product ASIN extraction /gp/product/ASIN (strips old params)', async () => {
        const rawUrl = 'https://www.amazon.in/gp/product/B0H1WVW8VY?smid=A1X';
        const result = await convertAmazonLink(rawUrl, affiliateTag, mockDomain);
        expect(result).toBe('https://www.amazon.in/dp/B0H1WVW8VY?tag=techstor0caaf-21');
    });

    test('Mobile ASIN extraction /gp/aw/d/ASIN', async () => {
        const rawUrl = 'https://www.amazon.in/gp/aw/d/B0H1WVW8VY';
        const result = await convertAmazonLink(rawUrl, affiliateTag, mockDomain);
        expect(result).toBe('https://www.amazon.in/dp/B0H1WVW8VY?tag=techstor0caaf-21');
    });

    test('Skip replacement if tag is already our tag', async () => {
        const rawUrl = 'https://www.amazon.in/dp/B0H1WVW8VY?tag=techstor0caaf-21';
        const result = await convertAmazonLink(rawUrl, affiliateTag, mockDomain);
        expect(result).toBe(rawUrl);
    });

    test('Fallback: Replace existing tag if no ASIN is found', async () => {
        const rawUrl = 'https://www.amazon.in/s?k=iphone&tag=competitor-21';
        const result = await convertAmazonLink(rawUrl, affiliateTag, mockDomain);
        expect(result).toBe('https://www.amazon.in/s?k=iphone&tag=techstor0caaf-21');
    });

    test('Fallback: Append tag if no tag or ASIN is found', async () => {
        const rawUrl = 'https://www.amazon.in/b?node=12345';
        const result = await convertAmazonLink(rawUrl, affiliateTag, mockDomain);
        expect(result).toBe('https://www.amazon.in/b?node=12345&tag=techstor0caaf-21');
    });

    test('isAmazonUrl correctly identifies Amazon vs Non-Amazon URLs', () => {
        expect(isAmazonUrl('https://www.amazon.in/dp/B0H1WVW8VY')).toBe(true);
        expect(isAmazonUrl('https://amzn.to/3XYZ')).toBe(true);
        expect(isAmazonUrl('https://amzn.eu/d/123')).toBe(true);
        expect(isAmazonUrl('https://link.amazon/abc')).toBe(true);
        expect(isAmazonUrl('https://amzaff.to/deal')).toBe(true);

        expect(isAmazonUrl('https://www.reliancedigital.in/item/123')).toBe(false);
        expect(isAmazonUrl('https://www.flipkart.com/item/123')).toBe(false);
        expect(isAmazonUrl('https://www.myntra.com/tshirt/456')).toBe(false);
        expect(isAmazonUrl('https://www.ajio.com/shoes/789')).toBe(false);
    });
});

describe('Offline Dealer Rate Quotes and Promotional Text Filter', () => {
    test('Strips Req Sumit Bhiwani, Req shiv kaithal, Req sachin bhiwani', () => {
        const input = '17 256 85700\nReq Sumit Bhiwani';
        expect(stripPromotionalContent(input)).toBe('17 256 85700');
    });

    test('Strips any foreign WhatsApp channel link (0029Va8sHsBDTkK7E9LCXq2D) and TinyURL redirect', () => {
        const input = `Only Mobile,TV Electronic Deals👇 
https://whatsapp.com/channel/0029Va8sHsBDTkK7E9LCXq2D
All Loots, Mobile Deals & Rate update 👇 
https://tinyurl.com/6vu4mdfp
🔥 Boat Airdopes at ₹899`;
        expect(stripPromotionalContent(input)).toBe('🔥 Boat Airdopes at ₹899');
    });
});

describe('Full Message Processing Pipeline & Drop Logic', () => {
    const affiliateTag = 'techstor0caaf-21';
    const mockDomain = 'amazon.in';
    const mockCuelinksKey = 'LmNADAnOLIEimDh8ItTaUEqjy1W_QTnfEkdXIaXqn7c';

    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('Drops offline dealer price lists with no buy links (returns empty string)', async () => {
        const message1 = `17 256 85700 
Req Sumit Bhiwani`;
        const result1 = await processMessageContent(message1, affiliateTag, mockDomain, mockCuelinksKey);
        expect(result1).toBe('');

        const message2 = `Ce6 8/128 32700 
Ce6  8/256 35700 
17 pro 🍊 121500
N6x 4/64 18400
N6 4/128 21300
Ce6lite 26050
nord 6 41500
T5x 8/128 26800
Fusion70 26900
k14 6/128 21000
kaithal`;
        const result2 = await processMessageContent(message2, affiliateTag, mockDomain, mockCuelinksKey);
        expect(result2).toBe('');
    });

    test('Drops message containing only promotional channel links and tinyurl redirect (returns empty string)', async () => {
        const message = `Only Mobile,TV Electronic Deals👇 
https://whatsapp.com/channel/0029Va8sHsBDTkK7E9LCXq2D
All Loots, Mobile Deals & Rate update 👇 
https://tinyurl.com/6vu4mdfp`;
        const result = await processMessageContent(message, affiliateTag, mockDomain, mockCuelinksKey);
        expect(result).toBe('');
    });

    test('Converts real Amazon deal, strips 0029Va8sHsBDTkK7E9LCXq2D and tinyurl, and appends TechSelect channel', async () => {
        const message = `Req Jind

Only Mobile,TV Electronic Deals👇 
https://whatsapp.com/channel/0029Va8sHsBDTkK7E9LCXq2D
All Loots, Mobile Deals & Rate update 👇 
https://tinyurl.com/6vu4mdfp

🔥 Apple iPhone 15 (128 GB) - Blue
Deal Price: ₹65,999 (MRP ₹79,900)
👉 Buy Here: https://www.amazon.in/dp/B0CHX1W1XY?tag=old-21&linkCode=ll1`;

        const expected = `🔥 Apple iPhone 15 (128 GB) - Blue
Deal Price: ₹65,999 (MRP ₹79,900)
👉 Buy Here: https://www.amazon.in/dp/B0CHX1W1XY?tag=techstor0caaf-21\n\n${TARGET_CHANNEL_LINK}`;

        const result = await processMessageContent(message, affiliateTag, mockDomain, mockCuelinksKey);
        expect(result).toBe(expected);
        expect(result).not.toContain('0029Va8sHsBDTkK7E9LCXq2D');
        expect(result).not.toContain('tinyurl.com/6vu4mdfp');
        expect(result).toContain('0029VbDdnbkG3R3e7wu0g70C');
    });

    test('Converts real Reliance Digital deal via Cuelinks and appends TechSelect channel', async () => {
        convertCuelinks.mockResolvedValueOnce('https://clnk.in/BWkg');

        const message = `Req Tohana

🔥 OnePlus Nord CE4 Lite 5G
Price: ₹17,999
Link: https://www.reliancedigital.in/oneplus-nord-ce4-lite/p/494421869

Only Mobile,TV Electronic Deals👇 
https://whatsapp.com/channel/0029Va8sHsBDTkK7E9LCXq2D`;

        const expected = `🔥 OnePlus Nord CE4 Lite 5G
Price: ₹17,999
Link: https://clnk.in/BWkg\n\n${TARGET_CHANNEL_LINK}`;

        const result = await processMessageContent(message, affiliateTag, mockDomain, mockCuelinksKey);
        expect(result).toBe(expected);
        expect(result).not.toContain('0029Va8sHsBDTkK7E9LCXq2D');
        expect(result).toContain('0029VbDdnbkG3R3e7wu0g70C');
    });

    // 20 Iteration Test Suite for Full Message Processing
    describe('20-Iteration Reliability Tests for Channel Stripping and TechSelect Appending', () => {
        for (let i = 1; i <= 20; i++) {
            test(`Iteration ${i}/20: Strips foreign channels and appends TechSelect channel`, async () => {
                convertCuelinks.mockResolvedValueOnce(`https://clnk.in/store${i}`);

                const foreignChannelId = `0029Va8sHsBDTkK7E9LCXq2D_${i}`;
                const message = `Req Jind
Only Mobile,TV Electronic Deals👇 
https://whatsapp.com/channel/${foreignChannelId}

🔥 Product Deal #${i}
Amazon: https://www.amazon.in/dp/B0000000${i > 9 ? i : '0' + i}?tag=spam-21
Other Store: https://www.myntra.com/deal/${i}

Follow us: https://whatsapp.com/channel/0029Va8sHsBDTkK7E9LCXq2D`;

                const result = await processMessageContent(message, affiliateTag, mockDomain, mockCuelinksKey);
                expect(result).toContain(`https://www.amazon.in/dp/B0000000${i > 9 ? i : '0' + i}?tag=techstor0caaf-21`);
                expect(result).toContain(`https://clnk.in/store${i}`);
                expect(result).not.toContain('Req Jind');
                expect(result).not.toContain(foreignChannelId);
                expect(result).not.toContain('0029Va8sHsBDTkK7E9LCXq2D');
                expect(result).toContain(TARGET_CHANNEL_LINK);
                // Check that TechSelect channel link appears exactly once
                const channelOccurrences = (result.match(/0029VbDdnbkG3R3e7wu0g70C/g) || []).length;
                expect(channelOccurrences).toBe(1);
            });
        }
    });
});
