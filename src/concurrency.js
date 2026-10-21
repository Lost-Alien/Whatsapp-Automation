async function mapSettled(items, concurrency, mapper) {
    const results = new Array(items.length);
    let next = 0;
    async function worker() {
        while (next < items.length) {
            const index = next++;
            try { results[index] = { status: 'fulfilled', value: await mapper(items[index], index) }; }
            catch (reason) { results[index] = { status: 'rejected', reason }; }
        }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
    return results;
}
module.exports = { mapSettled };
