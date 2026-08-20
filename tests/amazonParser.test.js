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

        expect(isAmazonUrl('https://www.flipkart.com/item/123')).toBe(false);
        expect(isAmazonUrl('https://www.myntra.com/tshirt/456')).toBe(false);
        expect(isAmazonUrl('https://www.ajio.com/shoes/789')).toBe(false);
    });
});

describe('Promotional Text and WhatsApp Channel Stripper Logic', () => {
    test('Strips Req Jind and Req Tohana', () => {
        const input1 = 'Req Jind\n🔥 Deal on Apple iPhone\nPrice: ₹65,999';
        expect(stripPromotionalContent(input1)).toBe('🔥 Deal on Apple iPhone\nPrice: ₹65,999');

        const input2 = 'Req Tohana\n🔥 Deal on Samsung Galaxy\nPrice: ₹25,999';
        expect(stripPromotionalContent(input2)).toBe('🔥 Deal on Samsung Galaxy\nPrice: ₹25,999');
    });

    test('Strips any WhatsApp channel link and promotional headers', () => {
        const input = `Only Mobile,TV Electronic Deals👇 
https://whatsapp.com/channel/0029Va8sHsBDTkK7E9LCXq2D
🔥 Boat Airdopes at ₹899`;
        expect(stripPromotionalContent(input)).toBe('🔥 Boat Airdopes at ₹899');
    });

    test('Strips WhatsApp channel with query params or different channel IDs', () => {
        const input = `🔥 Great Deal!
Check out: https://whatsapp.com/channel/0029VbABCDE12345?utm_source=chat
Follow us: https://www.whatsapp.com/channel/0029Va8sHsBDTkK7E9LCXq2D`;
        expect(stripPromotionalContent(input)).toBe('🔥 Great Deal!');
    });

    test('Strips "All Loots, Mobile Deals & Rate update" and TinyURL link', () => {
        const input = `All Loots, Mobile Deals & Rate update 👇 
https://tinyurl.com/6vu4mdfp
🔥 Smart TV 43 inch at ₹14,999`;
        expect(stripPromotionalContent(input)).toBe('🔥 Smart TV 43 inch at ₹14,999');
    });

    test('Strips 3rd party Telegram and redirect shorteners', () => {
        const input = `🔥 Great loot deal!
Join our Telegram: https://t.me/deals_channel
More loots: https://bit.ly/3xyz123`;
        expect(stripPromotionalContent(input)).toBe('🔥 Great loot deal!');
    });
});

describe('Full Message Processing Pipeline with TechSelect Channel Appender', () => {
    const affiliateTag = 'techstor0caaf-21';
    const mockDomain = 'amazon.in';
    const mockCuelinksKey = 'LmNADAnOLIEimDh8ItTaUEqjy1W_QTnfEkdXIaXqn7c';

    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('Strips https://whatsapp.com/channel/0029Va8sHsBDTkK7E9LCXq2D and always appends TechSelect channel', async () => {
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
        expect(result).toContain('0029VbDdnbkG3R3e7wu0g70C');
    });

    test('Full message with Flipkart link converts via Cuelinks and appends TechSelect channel', async () => {
        convertCuelinks.mockResolvedValueOnce('https://fkrt.clnk.in/BWhS');

        const message = `Req Tohana

🔥 Realme P1 5G Smartphone
Price: ₹14,999
Link: https://www.flipkart.com/realme-p1-5g/p/itm12345

Only Mobile,TV Electronic Deals👇 
https://whatsapp.com/channel/0029Va8sHsBDTkK7E9LCXq2D`;

        const expected = `🔥 Realme P1 5G Smartphone
Price: ₹14,999
Link: https://fkrt.clnk.in/BWhS\n\n${TARGET_CHANNEL_LINK}`;

        const result = await processMessageContent(message, affiliateTag, mockDomain, mockCuelinksKey);
        expect(result).toBe(expected);
        expect(result).not.toContain('0029Va8sHsBDTkK7E9LCXq2D');
        expect(result).toContain('0029VbDdnbkG3R3e7wu0g70C');
    });

    test('Mixed Message: Both Amazon and Flipkart links converted with respective affiliate engines', async () => {
        convertCuelinks.mockResolvedValueOnce('https://fkrt.clnk.in/deal123');

        const message = `🔥 Multi-Store Mega Sale!

Amazon Deal: https://www.amazon.in/dp/B0CHX1W1XY?tag=old-21
Flipkart Deal: https://www.flipkart.com/product/abcde

Join other channel: https://whatsapp.com/channel/0029Va8sHsBDTkK7E9LCXq2D`;

        const expected = `🔥 Multi-Store Mega Sale!

Amazon Deal: https://www.amazon.in/dp/B0CHX1W1XY?tag=techstor0caaf-21
Flipkart Deal: https://fkrt.clnk.in/deal123\n\n${TARGET_CHANNEL_LINK}`;

        const result = await processMessageContent(message, affiliateTag, mockDomain, mockCuelinksKey);
        expect(result).toBe(expected);
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
