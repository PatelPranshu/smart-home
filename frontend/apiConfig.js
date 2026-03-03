// ==========================================
// API CONFIGURATION 
// ==========================================

// Cloudflare Worker automatically routes and load balances between the backend servers.
// Therefore, we don't need complex frontend pinging or failover logic!
window.API_URL = 'https://blinkdrop.pranshuvramani-cloudfire.workers.dev/api';

// GLOBAL FETCH INTERCEPTOR FOR 401 UNAUTHORIZED
// (Applied globally to all fetch requests on frontend)
const _originalFetch = window.fetch;

window.fetch = async function (...args) {
    const response = await _originalFetch.apply(this, args);

    // Automatically log out if token expires or is invalid
    if (response.status === 401) {
        localStorage.removeItem('token');
        if (!window.location.pathname.endsWith('index.html') && window.location.pathname !== '/') {
            window.location.href = 'index.html';
        }
    }
    return response;
};
