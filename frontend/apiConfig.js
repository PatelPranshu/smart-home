// ==========================================
// API CONFIGURATION & FALLBACK LOGIC
// ==========================================

const SERVERS = [
    // 'http://192.168.31.30:3000/api',
    'https://smart-home-04m4.onrender.com/api',
    'https://smart-home-emergency02.onrender.com/api',
    
    
    
];

// ==========================================
// IN-MEMORY ACCESS TOKEN MANAGEMENT
// ==========================================
// SECURITY: Access token is NEVER stored in localStorage.
// It lives only in this JS variable and is lost on page refresh.
// Session is restored via the HttpOnly refreshToken cookie on page load.

let _currentAccessToken = null;

/** Get the current in-memory access token. */
function getAccessToken() { return _currentAccessToken; }

/** Set the in-memory access token (called after login or refresh). */
function setAccessToken(token) { _currentAccessToken = token; }

/** Clear the in-memory access token (called on logout). */
function clearAccessToken() { _currentAccessToken = null; }

// ==========================================
// SESSION RESTORATION (Silent Refresh on Page Load)
// ==========================================

/**
 * Attempts to restore an existing session by calling /api/refresh-token.
 * The HttpOnly cookie is sent automatically by the browser.
 * Returns true if session was restored, false otherwise.
 */
async function initSession() {
    try {
        const token = await tryRefreshToken();
        return !!token;
    } catch {
        return false;
    }
}

// Singleton promise to prevent concurrent refresh attempts
let _refreshPromise = null;

/**
 * Calls /api/refresh-token using the HttpOnly cookie.
 * Uses a singleton promise so concurrent 401 retries don't fire multiple refreshes.
 * @returns {Promise<string>} The new access token.
 */
async function tryRefreshToken() {
    // If a refresh is already in flight, piggyback on it
    if (_refreshPromise) return _refreshPromise;

    _refreshPromise = (async () => {
        // Use the lowest-level fetch to bypass our interceptors
        const res = await _nativeFetch(`${window.API_URL}/refresh-token`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' }
        });

        if (!res.ok) {
            clearAccessToken();
            throw new Error('Refresh failed');
        }

        const data = await res.json();
        setAccessToken(data.token);
        return data.token;
    })();

    try {
        return await _refreshPromise;
    } finally {
        _refreshPromise = null;
    }
}

// --- Server Mode Management ---
// 'auto' = original failover behavior, 'manual' = user picks the server
window.serverMode = localStorage.getItem('serverMode') || 'auto';

let savedBackend = localStorage.getItem('activeBackend');
const currentHost = window.location.hostname;

// 🔥 SMART CACHE BUSTING: If accessing via network IP (192.168...)
// but the browser stubbornly saved 'localhost', nuke the cached data programmatically.
if (savedBackend && savedBackend.includes('localhost') && currentHost !== 'localhost') {
    console.warn(`[API] Invalid cached backend (${savedBackend}) detected. Forcing reset.`);
    savedBackend = null;
    localStorage.removeItem('activeBackend');
}

if (window.serverMode === 'auto' || !savedBackend) {
    window.API_URL = SERVERS[0]; // Will now strictly pull your 192.168.x.x URL
    localStorage.removeItem('activeBackend');
} else {
    window.API_URL = savedBackend;
}

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
        // FIX: Reset back to Server 1 automatically when switching to Auto mode
        window.API_URL = SERVERS[0];
        localStorage.removeItem('activeBackend');
        
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
    // 1. Update the URL
    window.API_URL = url;
    localStorage.setItem('activeBackend', url);
    
    // 2. Lock the mode to manual (prevents auto-failover from overriding user choice)
    window.serverMode = 'manual';
    localStorage.setItem('serverMode', 'manual');
    
    // 3. Clear any pending auto-revert timers immediately
    _clearRevertTimer();
    
    // 4. Notify the UI
    window.dispatchEvent(new CustomEvent('activeServerChanged', { detail: { server: url } }));
    window.dispatchEvent(new CustomEvent('serverModeChanged', { detail: { mode: 'manual' } }));
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

        // Use the native fetch to avoid triggering our own interceptor
        const response = await _nativeFetch(`${serverUrl}/health?t=${Date.now()}`, {
            method: 'GET',
            signal: controller.signal
        });

        clearTimeout(timeoutId);
        return response.ok;
    } catch (error) {
        // 🔥 DEBUGGING FIX: Print the exact reason the ping is failing to the console
        console.error(`[API Health Check Failed] ${serverUrl}:`, error.message);
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
                // FIX: Do NOT store fallback server in localStorage so it resets on page load
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



// --- GLOBAL FETCH INTERCEPTOR (Auth + Failover) ---
// Saves native fetch ONCE before any wrappers
const _nativeFetch = window.fetch;

// Flag to prevent the interceptor from intercepting its own refresh calls
let _isRefreshing = false;

window.fetch = async function (...args) {
    let [input, init] = args;
    init = init || {};

    // Determine the target URL
    const targetUrl = input instanceof Request ? input.url : input.toString();
    const isApiRequest = SERVERS.some(server => targetUrl.startsWith(server));

    // ── Auto-inject auth headers & credentials for API requests ──
    if (isApiRequest) {
        // Ensure credentials: 'include' so the HttpOnly cookie is sent
        init.credentials = 'include';

        // Inject Authorization: Bearer header if we have an access token
        const token = getAccessToken();
        if (token) {
            if (!init.headers) {
                init.headers = {};
            }
            // Support both plain objects and Headers instances
            if (init.headers instanceof Headers) {
                if (!init.headers.has('Authorization')) {
                    init.headers.set('Authorization', `Bearer ${token}`);
                }
            } else {
                if (!init.headers['Authorization'] && !init.headers['authorization']) {
                    init.headers['Authorization'] = `Bearer ${token}`;
                }
            }
        }
    }

    let res;

    try {
        res = await _nativeFetch(input, init);

        // ── Handle 401: Silent Refresh ──
        if (res.status === 401 && isApiRequest && !_isRefreshing) {
            // Don't try to refresh if we're on the login page or this IS the refresh call
            const isRefreshEndpoint = targetUrl.includes('/refresh-token');
            const isLoginEndpoint = targetUrl.includes('/api/login');
            const isLogoutEndpoint = targetUrl.includes('/api/logout');

            if (!isRefreshEndpoint && !isLoginEndpoint && !isLogoutEndpoint) {
                try {
                    _isRefreshing = true;
                    await tryRefreshToken();
                    _isRefreshing = false;

                    // Retry the original request with the new token
                    const newToken = getAccessToken();
                    if (newToken) {
                        if (init.headers instanceof Headers) {
                            init.headers.set('Authorization', `Bearer ${newToken}`);
                        } else {
                            init.headers = init.headers || {};
                            init.headers['Authorization'] = `Bearer ${newToken}`;
                        }
                    }

                    // Retry
                    return await _nativeFetch(input, init);
                } catch (refreshErr) {
                    _isRefreshing = false;
                    // Refresh failed — session is dead, redirect to login
                    clearAccessToken();
                    if (!window.location.pathname.endsWith('index.html') && window.location.pathname !== '/') {
                        window.location.href = 'index.html';
                    }
                    return res; // Return the original 401
                }
            }

            return res;
        }

        // ── Handle 502/503: Server failover ──
        if (res.status === 502 || res.status === 503) {
            throw new Error(`Server returned ${res.status}`);
        }

        // Success — if we were counting down in manual mode, cancel it
        _clearRevertTimer();

        return res;
    } catch (error) {
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

                // Re-inject fresh auth header for the new server
                const freshToken = getAccessToken();
                if (freshToken) {
                    init.headers = init.headers || {};
                    if (init.headers instanceof Headers) {
                        init.headers.set('Authorization', `Bearer ${freshToken}`);
                    } else {
                        init.headers['Authorization'] = `Bearer ${freshToken}`;
                    }
                }

                let newArgs = [newTargetUrl, init];
                if (input instanceof Request) {
                    const newReq = new Request(newTargetUrl, input);
                    newArgs = [newReq, init];
                }

                return await _nativeFetch.apply(this, newArgs);
            }
        }

        throw error;
    }
};

// Perform initial check on script load
findActiveServer();