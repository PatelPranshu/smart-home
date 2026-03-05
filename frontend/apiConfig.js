// ==========================================
// API CONFIGURATION & FALLBACK LOGIC
// ==========================================

const SERVERS = [
    'http://localhost:3000/api',
    'http://localhost:3000/api'
];

// --- Server Mode Management ---
// 'auto' = original failover behavior, 'manual' = user picks the server
window.serverMode = localStorage.getItem('serverMode') || 'auto';
window.API_URL = localStorage.getItem('activeBackend') || SERVERS[0];

// Timer ID for the 20-second manual-mode auto-revert countdown
let _manualRevertTimerId = null;

/** Returns the current server mode ('auto' or 'manual'). */
function getServerMode() { return window.serverMode; }

/** Returns the current active API URL. */
function getActiveServer() { return window.API_URL; }

/** Returns the full SERVERS array. */
function getServers() { return SERVERS; }

/**
 * Switch between 'auto' and 'manual' mode.
 * @param {'auto'|'manual'} mode
 */
function setServerMode(mode) {
    window.serverMode = mode;
    localStorage.setItem('serverMode', mode);
    _clearRevertTimer();

    if (mode === 'auto') {
        // Immediately find best server when switching to auto
        findActiveServer();
    }

    window.dispatchEvent(new CustomEvent('serverModeChanged', { detail: { mode } }));
}

/**
 * Manually set the active server (only meaningful in manual mode).
 * @param {string} url
 */
function setManualServer(url) {
    window.API_URL = url;
    localStorage.setItem('activeBackend', url);
    _clearRevertTimer();
    window.dispatchEvent(new CustomEvent('activeServerChanged', { detail: { server: url } }));
}

// --- Health Check ---

/**
 * Pings the health endpoint of a server to check if it's available.
 * @param {string} serverUrl
 * @returns {Promise<boolean>}
 */
async function checkServerHealth(serverUrl) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5-second timeout

        // Use the original fetch to avoid triggering our own interceptor
        const fetchFn = typeof _originalFetch !== 'undefined' ? _originalFetch : window.fetch;
        const response = await fetchFn(`${serverUrl}/health?t=${Date.now()}`, {
            method: 'GET',
            signal: controller.signal
        });

        clearTimeout(timeoutId);
        return response.ok;
    } catch (error) {
        return false;
    }
}

// --- Active Server Discovery ---

/**
 * Finds the first available server from the SERVERS list.
 * In manual mode, only checks the current server (no failover).
 */
async function findActiveServer() {
    // In manual mode, we don't auto-switch
    if (window.serverMode === 'manual') {
        return;
    }

    // 1. Try the currently saved server first
    const isCurrentServerHealthy = await checkServerHealth(window.API_URL);
    if (isCurrentServerHealthy) {
        return; // Current server is fine
    }

    console.warn(`[API] Current server ${window.API_URL} is down. Looking for a fallback...`);

    // 2. If current is down, check others in order
    for (const server of SERVERS) {
        if (server !== window.API_URL) {
            console.log(`[API] Checking fallback server: ${server}`);
            const isHealthy = await checkServerHealth(server);

            if (isHealthy) {
                console.log(`[API] Switching to healthy fallback: ${server}`);
                window.API_URL = server;
                localStorage.setItem('activeBackend', server);
                window.dispatchEvent(new CustomEvent('activeServerChanged', { detail: { server } }));
                return;
            }
        }
    }

    console.error("[API] All configured backend servers are unreachable.");
}

// --- Manual Mode: 20-Second Auto-Revert ---

function _clearRevertTimer() {
    if (_manualRevertTimerId) {
        clearTimeout(_manualRevertTimerId);
        _manualRevertTimerId = null;
        window.dispatchEvent(new CustomEvent('manualRevertCancelled'));
    }
}

function _startManualRevertCountdown() {
    if (_manualRevertTimerId) return; // Already counting down

    console.warn('[API] Manual server unreachable. Auto-reverting to automatic in 20s...');
    window.dispatchEvent(new CustomEvent('manualRevertStarted'));

    _manualRevertTimerId = setTimeout(() => {
        _manualRevertTimerId = null;
        console.warn('[API] 20s elapsed — reverting to automatic mode.');
        setServerMode('auto');
    }, 20000);
}

// Perform initial check on script load
findActiveServer();

// --- GLOBAL FETCH INTERCEPTOR FOR AUTOMATIC FAILOVER ---
const _originalFetch = window.fetch;

window.fetch = async function (...args) {
    let res;

    try {
        res = await _originalFetch.apply(this, args);

        if (res.status === 401) {
            return res;
        }

        if (res.status === 502 || res.status === 503) {
            throw new Error(`Server returned ${res.status}`);
        }

        // Success — if we were counting down in manual mode, cancel it
        _clearRevertTimer();

        return res;
    } catch (error) {
        const targetUrl = args[0] instanceof Request ? args[0].url : args[0].toString();
        const isApiRequest = SERVERS.some(server => targetUrl.startsWith(server));

        if (isApiRequest) {
            console.warn(`[API] Network error or server offline on ${targetUrl}:`, error.message);

            // --- Manual mode: start 20s countdown instead of instant failover ---
            if (window.serverMode === 'manual') {
                _startManualRevertCountdown();
                throw error; // Don't retry, let it fail this time
            }

            // --- Auto mode: normal failover ---
            await findActiveServer();

            const oldApiServer = SERVERS.find(server => targetUrl.startsWith(server));
            if (oldApiServer && oldApiServer !== window.API_URL) {
                const endpoint = targetUrl.substring(oldApiServer.length);
                const newTargetUrl = window.API_URL + endpoint;

                console.log(`[API] Retrying request on new server: ${newTargetUrl}`);

                let newArgs = [newTargetUrl];
                if (args.length > 1) {
                    newArgs.push(args[1]);
                } else if (args[0] instanceof Request) {
                    const newReq = new Request(newTargetUrl, args[0]);
                    newArgs = [newReq];
                }

                return await _originalFetch.apply(this, newArgs);
            }
        }

        throw error;
    }
};