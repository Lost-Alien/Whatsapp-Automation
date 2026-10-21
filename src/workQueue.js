const fs = require('node:fs');
const path = require('node:path');

class WorkQueue {
    constructor({ file, processJob, maxPending = 100, maxAttempts = 5, retryMs = 5000, onError = () => {} }) {
        this.file = file;
        this.processJob = processJob;
        this.maxPending = maxPending;
        this.maxAttempts = maxAttempts;
        this.retryMs = retryMs;
        this.onError = onError;
        this.running = false;
        this.busy = false;
        this.timer = null;
        this.lastError = null;
        this.state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { pending: [], delivered: {} };
        if (!Array.isArray(this.state.pending) || !this.state.delivered || this.state.pending.length > maxPending) {
            throw new Error('Invalid saved message queue; restore or inspect it before starting');
        }
    }

    save() {
        fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
        const temporary = this.file + '.tmp';
        fs.writeFileSync(temporary, JSON.stringify(this.state), { mode: 0o600 });
        fs.renameSync(temporary, this.file);
        this.lastError = null;
    }

    enqueue(job) {
        if (Object.hasOwn(this.state.delivered, job.id) || this.state.pending.some(item => item.id === job.id)) return false;
        if (this.state.pending.length >= this.maxPending) throw new Error('Message queue full; pending deals retained');
        if (Buffer.byteLength(job.body, 'utf8') > 65536) throw new Error('Message exceeds queue size limit');
        const entry = { ...job, attempts: 0, nextAt: 0, createdAt: Date.now() };
        this.state.pending.push(entry);
        try { this.save(); } catch (error) { this.state.pending.pop(); throw error; }
        this.schedule(0);
        return true;
    }

    start() { this.running = true; this.schedule(0); }

    retryFailed() {
        for (const job of this.state.pending) {
            if (job.failed) { job.failed = false; job.attempts = 0; job.nextAt = 0; }
        }
        this.save();
        this.schedule(0);
    }

    stop() {
        this.running = false;
        clearTimeout(this.timer);
        this.timer = null;
    }

    schedule(delay) {
        if (!this.running || this.busy || this.timer) return;
        this.timer = setTimeout(() => {
            this.timer = null;
            this.tick().catch(error => {
                this.lastError = error.message;
                this.onError(error);
                this.stop();
            });
        }, delay);
        this.timer.unref?.();
    }

    async tick() {
        if (!this.running || this.busy) return;
        const job = this.state.pending.find(item => !item.failed);
        if (!job) return;
        if (job.nextAt > Date.now()) { this.schedule(job.nextAt - Date.now()); return; }
        this.busy = true;
        try {
            await this.processJob(job);
            this.state.pending = this.state.pending.filter(item => item.id !== job.id);
            this.state.delivered[job.id] = Date.now();
            const recent = Object.entries(this.state.delivered)
                .filter(([, timestamp]) => timestamp > Date.now() - 7 * 86400000)
                .sort((a, b) => b[1] - a[1]).slice(0, 1000);
            this.state.delivered = Object.fromEntries(recent);
        } catch (error) {
            job.attempts += 1;
            job.nextAt = Date.now() + Math.min(60000, this.retryMs * 2 ** (job.attempts - 1));
            job.failed = job.attempts >= this.maxAttempts;
            job.error = String(error.message).slice(0, 200);
            this.onError(error);
        } finally {
            this.busy = false;
        }
        this.save();
        this.schedule(0);
    }

    snapshot() {
        return { pending: this.state.pending.length, failed: this.state.pending.filter(item => item.failed).length,
            active: this.busy, capacity: this.maxPending, error: this.lastError };
    }
}

module.exports = { WorkQueue };
