function createShutdown({ getClient, stopWork, closeServer, onStopping, exit = code => process.exit(code), timeoutMs = 20000 }) {
    let stopping = false;
    return async function shutdown(code, reason) {
        if (stopping) return;
        stopping = true;
        const deadline = setTimeout(() => exit(code || 1), timeoutMs);
        deadline.unref?.();
        onStopping(reason);
        stopWork();
        try {
            const current = getClient();
            current?.removeAllListeners();
            await current?.destroy();
        } catch (_) { /* systemd also terminates remaining Chrome descendants. */ }
        try { await closeServer(); } catch (_) { /* Exit still performs service cleanup. */ }
        clearTimeout(deadline);
        exit(code);
    };
}
module.exports = { createShutdown };
