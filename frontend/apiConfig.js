// ==========================================
// API CONFIGURATION & FALLBACK LOGIC
// ==========================================

const SERVERS = [
    'https://smart-home-04m4.onrender.com/api',
    'https://smart-home-emergency.onrender.com/api'
];

// Initialize with the first server
window.API_URL = localStorage.getItem('activeBackend') || SERVERS[0];

/**
 * Pings the health endpoint of a server to check if it's available.
 * @param {string} serverUrl
 * @returns {Promise<boolean>}
 */
async function checkServerHealth(serverUrl) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5-second timeout

        const response = await fetch(`${serverUrl}/health`, {
            method: 'GET',
            signal: controller.signal,
            headers: {
                // Prevent caching the health check response
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            }
        });

        clearTimeout(timeoutId);
        return response.ok;
    } catch (error) {
        return false;
    }
}

/**
 * Finds the first available server from the SERVERS list.
 */
async function findActiveServer() {
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
                return;
            }
        }
    }

    console.error("[API] All configured backend servers are unreachable.");
}

// Perform initial check on script load, but don't block the rest of the app.
// It will try to find a healthy server in the background.
findActiveServer();

// GLOBAL FETCH INTERCEPTOR FOR AUTOMATIC FAILOVER
const _originalFetch = window.fetch;

window.fetch = async function (...args) {
    // If the URL is relative or matches an API URL, we might need to retry it
    let res;

    try {
        res = await _originalFetch.apply(this, args);

        // Let the standard auth logic handle 401s (which is what app.js/admin.js expects)
        if (res.status === 401) {
            return res;
        }

        // If it's a 502 Bad Gateway or 503 Service Unavailable, the server might be down
        if (res.status === 502 || res.status === 503) {
            throw new Error(`Server returned ${res.status}`);
        }

        return res;
    } catch (error) {
        // Only trigger failover if request was to our API
        const targetUrl = args[0] instanceof Request ? args[0].url : args[0].toString();
        const isApiRequest = SERVERS.some(server => targetUrl.startsWith(server));

        if (isApiRequest) {
            console.warn(`[API] Network error or server offline on ${targetUrl}:`, error.message);

            // Look for a healthy server
            await findActiveServer();

            // Calculate the new target URL based on the new API_URL
            const oldApiServer = SERVERS.find(server => targetUrl.startsWith(server));
            if (oldApiServer && oldApiServer !== window.API_URL) {
                // Reconstruct the request with the new base URL
                const endpoint = targetUrl.substring(oldApiServer.length);
                const newTargetUrl = window.API_URL + endpoint;

                console.log(`[API] Retrying request on new server: ${newTargetUrl}`);

                // Copy options/Request details
                let newArgs = [newTargetUrl];
                if (args.length > 1) {
                    newArgs.push(args[1]);
                } else if (args[0] instanceof Request) {
                    // It's a Request object, need to rebuild if we want to change URL
                    const newReq = new Request(newTargetUrl, args[0]);
                    newArgs = [newReq];
                }

                return await _originalFetch.apply(this, newArgs);
            }
        }

        // If not an API request, or failover didn't change the server, re-throw
        throw error;
    }
};
