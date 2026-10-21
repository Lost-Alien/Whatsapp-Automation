const fs = require('node:fs');
const path = require('node:path');

function readNumber(file) {
    try { const value = fs.readFileSync(file, 'utf8').trim(); return value === 'max' ? null : Number(value); }
    catch (_) { return null; }
}

function runtimeMemory() {
    const result = {};
    try {
        const info = fs.readFileSync('/proc/meminfo', 'utf8');
        const available = info.match(/^MemAvailable:\s+(\d+)/m);
        if (available) result.available = Math.round(Number(available[1]) / 1024);
        const group = fs.readFileSync('/proc/self/cgroup', 'utf8').match(/^0::(.+)$/m);
        if (group) {
            const directory = path.join('/sys/fs/cgroup', group[1]);
            for (const [key, name] of Object.entries({ service: 'memory.current', serviceLimit: 'memory.max', swap: 'memory.swap.current' })) {
                const bytes = readNumber(path.join(directory, name));
                result[key] = bytes === null ? null : Math.round(bytes / 1048576);
            }
        }
    } catch (_) { /* Non-Linux hosts retain Node's RSS and OS memory fallback. */ }
    return result;
}
module.exports = { runtimeMemory };
