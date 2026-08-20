const { 
    TARGET_CHANNEL_LINK,
    convertAmazonLink, 
    stripPromotionalContent, 
    processMessageContent 
} = require('../src/amazonParser');

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
});

describe('Promotional Text and URL Stripper Logic', () => {
    test('Strips Req Jind and Req Tohana', () => {
        const input1 = 'Req Jind\n🔥 Deal on Apple iPhone\nPrice: ₹65,999';
        expect(stripPromotionalContent(input1)).toBe('🔥 Deal on Apple iPhone\nPrice: ₹65,999');

        const input2 = 'Req Tohana\n🔥 Deal on Samsung Galaxy\nPrice: ₹25,999';
        expect(stripPromotionalContent(input2)).toBe('🔥 Deal on Samsung Galaxy\nPrice: ₹25,999');
    });

    test('Strips "Only Mobile,TV Electronic Deals" and WhatsApp channel link', () => {
        const input = `Only Mobile,TV Electronic Deals👇 
https://whatsapp.com/channel/0029Va8sHsBDTkK7E9LCXq2D
🔥 Boat Airdopes at ₹899`;
        expect(stripPromotionalContent(input)).toBe('🔥 Boat Airdopes at ₹899');
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

describe('Full Message Processing Pipeline', () => {
    const affiliateTag = 'techstor0caaf-21';
    const mockDomain = 'amazon.in';

    test('Full message with Req Jind, promo channels, tinyurls, and Amazon link', async () => {
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

        const result = await processMessageContent(message, affiliateTag, mockDomain);
        expect(result).toBe(expected);
    });

    test('Full message with Req Tohana and trailing promos', async () => {
        const message = `Req Tohana

🔥 Noise Pulse 2 Max Smartwatch
Price: ₹1,199
Link: https://www.amazon.in/dp/B0B6916B6F?tag=other-21

Only Mobile,TV Electronic Deals👇 
https://whatsapp.com/channel/0029Va8sHsBDTkK7E9LCXq2D`;

        const expected = `🔥 Noise Pulse 2 Max Smartwatch
Price: ₹1,199
Link: https://www.amazon.in/dp/B0B6916B6F?tag=techstor0caaf-21\n\n${TARGET_CHANNEL_LINK}`;

        const result = await processMessageContent(message, affiliateTag, mockDomain);
        expect(result).toBe(expected);
    });

    test('Handles message that already has target channel link without duplicating it', async () => {
        const message = `🔥 Great Deal https://www.amazon.in/dp/B0CHX1W1XY\n\n${TARGET_CHANNEL_LINK}`;
        const result = await processMessageContent(message, affiliateTag, mockDomain);
        const occurrences = (result.match(new RegExp(TARGET_CHANNEL_LINK, 'g')) || []).length;
        expect(occurrences).toBe(1);
    });
});
