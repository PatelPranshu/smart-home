// ==========================================
// 1. GLOBAL CONFIGURATION & ROUTER
// ==========================================

// Determine API URL (Localhost vs Render)
const API_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3000/api'
    : 'https://smarthome-backend-rbmc.onrender.com/api';
// const API_URL = 'https://smarthome-backend-rbmc.onrender.com/api';
// const API_URL = 'http://localhost:3000/api';
// Global State
const token = localStorage.getItem('token');
const path = window.location.pathname;

// ==========================================
// 0. TOAST NOTIFICATION SYSTEM (New)
// ==========================================
// Inject Styles dynamically
const style = document.createElement('style');
style.innerHTML = `
  .toast-container { position: fixed; top: 20px; right: 20px; z-index: 10000; display: flex; flex-direction: column; gap: 10px; }
  .toast { min-width: 250px; padding: 16px; border-radius: 12px; background: white; box-shadow: 0 5px 15px rgba(0,0,0,0.15); display: flex; align-items: center; animation: slideIn 0.3s ease; border-left: 6px solid #333; font-family: 'Inter', sans-serif; font-size: 0.95rem; font-weight: 500; }
  .toast.success { border-color: #22c55e; } .toast.success i { color: #22c55e; }
  .toast.error { border-color: #ef4444; } .toast.error i { color: #ef4444; }
  .toast.warning { border-color: #f59e0b; } .toast.warning i { color: #f59e0b; }
  @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
`;
document.head.appendChild(style);

function showToast(message, type = 'info') {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    // Icons based on type
    let icon = 'fa-circle-info';
    if(type === 'success') icon = 'fa-circle-check';
    if(type === 'error') icon = 'fa-circle-exclamation';
    if(type === 'warning') icon = 'fa-triangle-exclamation';

    toast.innerHTML = `<i class="fa-solid ${icon}" style="margin-right:12px; font-size:1.3rem;"></i> <span>${message}</span>`;
    container.appendChild(toast);

    // Remove after 3 seconds
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Shared Icon Mapping
const typeIcons = {
    'light': 'fa-lightbulb',
    'fan': 'fa-fan',
    'ac': 'fa-snowflake',
    'tv': 'fa-tv',
    'wifi': 'fa-wifi',
    'socket': 'fa-plug',
    'water': 'fa-faucet-drip',
    'laundry': 'fa-shirt'
};

// --- ROUTER: Run code based on current page ---
document.addEventListener('DOMContentLoaded', () => {
    
    // A. Auth Check: Redirect to Login if no token (and not on login page)
    if (!token && !path.endsWith('index.html') && path !== '/') {
        window.location.href = 'index.html';
        return;
    }

    // B. Auth Check: Redirect to Home if logged in (and on login page)
    if (token && (path.endsWith('index.html') || path === '/')) {
        window.location.href = 'home.html';
        return;
    }

    // C. Initialize Specific Page Logic
    if (path.includes('home.html')) initHome();
    if (path.includes('energy.html')) initEnergy();
    if (path.includes('settings.html')) initSettings();
    if (path.includes('index.html') || path === '/') initLogin();
});


// ==========================================
// 2. PAGE: LOGIN (index.html)
// ==========================================
function initLogin() {
    const loginForm = document.getElementById('login-form');
    const regForm = document.getElementById('register-form');
    const authMsg = document.getElementById('auth-msg');

    // Toggle between Login and Register
    window.toggleAuth = (view) => {
        authMsg.classList.add('hidden');
        if (view === 'register') {
            loginForm.classList.add('hidden');
            regForm.classList.remove('hidden');
        } else {
            regForm.classList.add('hidden');
            loginForm.classList.remove('hidden');
        }
    };

    // Handle Login
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        await handleAuth('/login', { email, password });
    });

    // Handle Register
    regForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('reg-email').value;
        const password = document.getElementById('reg-password').value;
        await handleAuth('/register', { email, password });
    });

    async function handleAuth(endpoint, body) {
        try {
            const res = await fetch(`${API_URL}${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await res.json();

            if (data.token) {
                localStorage.setItem('token', data.token);
                localStorage.setItem('userEmail', body.email);
                window.location.href = 'home.html';
            } else if (data.status === 'ok') {
                showToast("Account created! Please log in.", "success");
                window.toggleAuth('login');
            } else {
                authMsg.innerText = data.error || "Error";
                authMsg.classList.remove('hidden');
            }
        } catch (err) {
            authMsg.innerText = "Server Error. Is Backend Running?";
            authMsg.classList.remove('hidden');
        }
    }
}


// ==========================================
// 3. PAGE: HOME (home.html)
// ==========================================
function initHome() {
    // 1. Set Date
    const dateOptions = { weekday: 'long', month: 'long', day: 'numeric' };
    document.getElementById('date-display').innerText = new Date().toLocaleDateString('en-US', dateOptions);

    // 2. Start Syncing
    fetchDevices();
    setInterval(fetchDevices, 2000); // Live update

    // --- MODAL VARIABLES ---
    window.currentDeviceId = null;
    window.currentSwitchId = null;
    window.selectedType = 'light';

    // --- MODAL FUNCTIONS (Exposed to window for HTML onclick) ---
    window.openModal = (deviceId, switchId, name, type) => {
        window.currentDeviceId = deviceId;
        window.currentSwitchId = switchId;
        
        // 1. Force Lowercase to match HTML attributes
        window.selectedType = (type || 'light').toLowerCase(); 

        document.getElementById('edit-name').value = name;
        document.getElementById('timer-hrs').value = "";
        document.getElementById('timer-mins').value = "";

        // 2. Clear old selection
        document.querySelectorAll('.type-option').forEach(el => el.classList.remove('selected'));

        // 3. Find and Highlight the correct icon
        let activeOption = document.querySelector(`.type-option[data-type="${window.selectedType}"]`);
        
        // Safety Fallback: If type not found (e.g. 'unknown'), select 'light' by default
        if (!activeOption) {
             window.selectedType = 'light';
             activeOption = document.querySelector(`.type-option[data-type="light"]`);
        }

        if (activeOption) activeOption.classList.add('selected');

        document.getElementById('edit-modal').classList.remove('hidden');
    };

    window.closeModal = () => {
        document.getElementById('edit-modal').classList.add('hidden');
    };

    window.selectType = (type) => {
        window.selectedType = type;
        document.querySelectorAll('.type-option').forEach(el => el.classList.remove('selected'));
        event.currentTarget.classList.add('selected');
    };

    window.saveChanges = async () => {
        const newName = document.getElementById('edit-name').value;
        try {
            await fetch(`${API_URL}/edit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-access-token': token },
                body: JSON.stringify({ 
                    deviceId: window.currentDeviceId, 
                    switchId: window.currentSwitchId, 
                    newName, 
                    newType: window.selectedType 
                })
            });
            window.closeModal();
            fetchDevices();
        } catch (err) { showToast("Failed to save changes", "error"); }
    };

    window.setTimer = async () => {
        const hrs = parseInt(document.getElementById('timer-hrs').value) || 0;
        const mins = parseInt(document.getElementById('timer-mins').value) || 0;
        if (hrs === 0 && mins === 0) return showToast("Please enter a valid time", "warning");

        try {
            await fetch(`${API_URL}/timer`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-access-token': token },
                body: JSON.stringify({ 
                    deviceId: window.currentDeviceId, 
                    switchId: window.currentSwitchId, 
                    minutes: (hrs * 60) + mins 
                })
            });
            window.closeModal();
            fetchDevices();
        } catch (err) { { showToast("Failed to set timer", "error"); } }
    };
}


// ==========================================
// 4. PAGE: ENERGY / HISTORY (energy.html)
// ==========================================
async function initEnergy() {
    const list = document.getElementById('history-list');
    
    async function loadHistory() {
        try {
            // Fetch real history logs from backend
            const res = await fetch(`${API_URL}/history?t=${Date.now()}`, { 
                headers: { 'x-access-token': token },
                cache: 'no-store'
            });
            const logs = await res.json();
            
            list.innerHTML = ''; 

            if (logs.length === 0) {
                list.innerHTML = '<p style="text-align:center; color:#999; margin-top:20px;">No activity in the last 24 hours.</p>';
                return;
            }

            logs.forEach(log => {
                const item = document.createElement('div');
                item.className = 'history-item';
                
                // Format Date (e.g., "10:30 AM")
                const timeStr = new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const dateStr = new Date(log.timestamp).toLocaleDateString();

                // Determine Color (Green for ON, Red for OFF)
                const isOne = log.action.includes("ON");
                const color = isOne ? '#22c55e' : '#ef4444';
                const icon = isOne ? 'fa-toggle-on' : 'fa-toggle-off';

                item.innerHTML = `
                    <div style="display:flex; align-items:center; gap:15px;">
                        <div style="width:40px; height:40px; background:#f3f4f6; border-radius:50%; display:flex; align-items:center; justify-content:center; color:${color}; font-size:1.2rem;">
                            <i class="fa-solid ${icon}"></i>
                        </div>
                        <div>
                            <div style="font-weight:600; color:#333;">${log.switchName}</div>
                            <div style="font-size:0.8rem; color:#666;">${log.action}</div>
                        </div>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-weight:700; font-size:0.9rem; color:#333;">${timeStr}</div>
                        <div style="font-size:0.7rem; color:#9ca3af;">${dateStr}</div>
                    </div>
                `;
                item.style.cssText = "display: flex; justify-content: space-between; align-items: center; background: white; padding: 15px; border-radius: 12px; margin-bottom: 10px; box-shadow: 0 2px 5px rgba(0,0,0,0.05);";
                list.appendChild(item);
            });

        } catch(err) {
            console.error(err);
            list.innerText = "Failed to load history.";
        }
    }

    loadHistory();
    setInterval(loadHistory, 5000); // Refresh every 5s
}


// ==========================================
// 5. PAGE: SETTINGS (settings.html)
// ==========================================
async function initSettings() {
    // 1. Load User Info
    // You might need an endpoint like /api/me to get the email, or store it in localStorage on login
    const userEmail = localStorage.getItem('userEmail') || "User"; 
    document.getElementById('username-display').innerText = userEmail;

    // --- HELPER: Close all modals ---
    window.closeModals = () => {
        document.querySelectorAll('.modal-overlay').forEach(el => el.classList.add('hidden'));
    };

    // --- FLOW 1: CHANGE PASSWORD (ESP CODE CHECK) ---
    
    window.openVerifyCodeModal = () => {
        document.getElementById('input-esp-code').value = "";
        document.getElementById('modal-verify-code').classList.remove('hidden');
    };

    window.verifyEspCode = async () => {
        const code = document.getElementById('input-esp-code').value;
        if (!code) return showToast("Please enter the code.", "warning");

        try {
            const res = await fetch(`${API_URL}/verify-code`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-access-token': token },
                body: JSON.stringify({ code })
            });

            if (res.ok) {
                window.closeModals();
                document.getElementById('modal-change-pass').classList.remove('hidden'); // Show next step
            } else {
                showToast("Invalid ESP32 Kit Code", "error");
            }
        } catch (err) {showToast("Verification Error", "error"); }
    };

    window.submitNewPassword = async () => {
        const newPass = document.getElementById('input-new-pass').value;
        if (!newPass) return showToast("Please enter a new password", "warning");

        try {
            const res = await fetch(`${API_URL}/user-update`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-access-token': token },
                body: JSON.stringify({ password: newPass })
            });
            if (res.ok) {
                showToast("Password Updated! Logging out...", "success");
                logout();
            } else {
                showToast("Failed to update password", "error");
            }
        } catch (err) { showToast("An error occurred", "error"); }
    };


    // --- FLOW 2: CHANGE WI-FI (USER PASS CHECK) ---

    window.openVerifyPassModal = () => {
        document.getElementById('input-user-pass').value = "";
        document.getElementById('modal-verify-pass').classList.remove('hidden');
    };

    window.verifyUserPass = async () => {
        const password = document.getElementById('input-user-pass').value;
        if (!password) return showToast("Please enter your password", "warning");

        try {
            const res = await fetch(`${API_URL}/verify-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-access-token': token },
                body: JSON.stringify({ password })
            });

            if (res.ok) {
                window.closeModals();
                await loadDevicesForWifi(); // Fetch devices only after verification
                document.getElementById('modal-wifi-settings').classList.remove('hidden'); // Show next step
            } else {
                showToast("Incorrect Password", "error");
            }
        } catch (err) { showToast("Verification Error", "error"); }
    };

    async function loadDevicesForWifi() {
        const select = document.getElementById('device-select');
        select.innerHTML = '<option>Loading...</option>';
        try {
            const res = await fetch(`${API_URL}/devices`, { headers: { 'x-access-token': token } });
            const devices = await res.json();
            select.innerHTML = '';
            devices.forEach(d => {
                const opt = document.createElement('option');
                opt.value = d.deviceId;
                opt.innerText = `Device: ${d.deviceId}`;
                select.appendChild(opt);
            });
        } catch (err) { select.innerHTML = '<option>Error</option>'; }
    }

    window.submitWifiSettings = async () => {
        const deviceId = document.getElementById('device-select').value;
        const ssid = document.getElementById('wifi-ssid').value;
        const pass = document.getElementById('wifi-pass').value;

        if (!ssid || !pass) return showToast("Please fill all fields", "warning");

        // --- CHANGE: Removed confirm() popup ---
        // Instead, we just notify the user that the process has started
        showToast("Sending configuration... Device will restart shortly.", "info");

        try {
            await fetch(`${API_URL}/wifi-config`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-access-token': token },
                body: JSON.stringify({ deviceId, ssid, pass })
            });
            
            // Wait a moment before closing so user sees the "Info" toast first
            setTimeout(() => {
                showToast("Wi-Fi Update Sent!", "success");
                window.closeModals();
            }, 1000);

        } catch (err) { 
            showToast("Failed to send Wi-Fi settings", "error"); 
        }
    };
}


// ==========================================
// 6. SHARED HELPERS (Used by Home & Energy)
// ==========================================

// ==========================================
// 6. SHARED HELPERS (Used by Home & Energy)
// ==========================================

async function fetchDevices() {
    // Only runs if on Home or Energy page
    const grid = document.getElementById('device-grid');
    if (!grid) return; // Safety check

    try {
        // --- FIX: Prevent Browser Caching ---
        // 1. Add unique timestamp query (?t=...)
        // 2. Add cache: 'no-store' option
        const res = await fetch(`${API_URL}/devices?t=${Date.now()}`, { 
            headers: { 'x-access-token': token },
            cache: 'no-store'
        });
        
        const devices = await res.json();
        renderGrid(devices);
    } catch (err) { console.error("Fetch error", err); }
}

function renderGrid(devices) {
    const grid = document.getElementById('device-grid');
    if(!grid) return;

    devices.forEach(device => {
        const isOnline = device.isOnline;

        device.switches.forEach(sw => {
            const domId = `card-${device.deviceId}-${sw.id}`;
            let card = document.getElementById(domId);
            const dbType = sw.type || 'light'; 
            const iconClass = typeIcons[dbType] || 'fa-power-off';

            // Time Logic
            let runtimeText = "", timerText = "";
            if (isOnline && sw.state && sw.lastOnTime) {
                const diffMs = new Date() - new Date(sw.lastOnTime);
                const mins = Math.floor(diffMs / 60000);
                const hrs = Math.floor(mins / 60);
                runtimeText = hrs > 0 ? `${hrs}h ${mins % 60}m` : `${mins} mins`;
            }
            if (isOnline && sw.state && sw.timerExpiresAt) {
                const timeLeftMs = new Date(sw.timerExpiresAt) - new Date();
                if (timeLeftMs > 0) {
                    timerText = `${Math.ceil(timeLeftMs / 60000)}m left`;
                }
            }

            // Create Card if missing
            if (!card) {
                card = document.createElement('div');
                card.id = domId;
                card.innerHTML = `
                    <div class="offline-overlay hidden"><i class="fa-solid fa-wifi"></i><span>Disconnected</span></div>
                    <div class="card-options"><i class="fa-solid fa-ellipsis-vertical"></i></div>
                    <div class="card-header">
                        <div class="device-icon"><i class="fa-solid ${iconClass}"></i><div class="spinner"></div></div>
                    </div>
                    <div class="card-footer">
                        <div class="footer-left"><div class="device-name">${sw.name}</div><div class="device-status">OFF</div></div>
                        <div class="footer-right"><div class="runtime-display"></div><div class="timer-display"></div></div>
                    </div>`;
                grid.appendChild(card);
            }

            // Update DOM Elements
            const overlay = card.querySelector('.offline-overlay');
            const optionsBtn = card.querySelector('.card-options');
            
            // Offline/Online Logic
            if (!isOnline) {
                card.classList.add('device-offline'); 
                overlay.classList.remove('hidden');   
                card.onclick = null;
            } else {
                card.classList.remove('device-offline');
                overlay.classList.add('hidden');
                if (!card.classList.contains('card-loading')) {
                    card.onclick = () => toggleDevice(device.deviceId, sw.id, !sw.state, card);
                }
            }

            // Update Button Listener
            if(optionsBtn) {
                optionsBtn.onclick = (e) => {
                    e.stopPropagation();
                    if(isOnline && window.openModal) window.openModal(device.deviceId, sw.id, sw.name, dbType);
                };
            }

            // Update UI (Text, Icon, Colors)
            const nameEl = card.querySelector('.device-name');
            if(nameEl) nameEl.innerText = sw.name;

            const iconEl = card.querySelector('.device-icon i');
            if(iconEl && !card.classList.contains('card-loading')) iconEl.className = `fa-solid ${iconClass}`;

            const runtimeDiv = card.querySelector('.runtime-display');
            const timerDiv = card.querySelector('.timer-display');
            if(runtimeDiv) { runtimeDiv.innerText = runtimeText; runtimeDiv.style.display = runtimeText ? 'block' : 'none'; }
            if(timerDiv) { timerDiv.innerText = timerText; timerDiv.style.display = timerText ? 'block' : 'none'; }

            if (!card.classList.contains('card-loading')) {
                const isActive = sw.state; 
                const statusText = card.querySelector('.device-status');
                const iconDiv = card.querySelector('.device-icon');
                
                let baseClass = 'device-card';
                if (!isOnline) baseClass += ' device-offline';
                else if (isActive) baseClass += ' is-active';
                card.className = baseClass;

                if(iconDiv) iconDiv.className = isActive ? 'device-icon icon-on' : 'device-icon icon-off';
                if(statusText) {
                    statusText.className = isActive ? 'device-status text-on' : 'device-status text-off';
                    statusText.innerText = isActive ? 'ON' : 'OFF';
                }
            }
        });
    });
}

async function toggleDevice(deviceId, switchId, newState, cardElement) {
    cardElement.classList.add('card-loading');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
        const response = await fetch(`${API_URL}/control`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-access-token': token },
            body: JSON.stringify({ deviceId, switchId, state: newState }),
            signal: controller.signal
        });
        clearTimeout(timeoutId); 
        if (!response.ok) throw new Error("Error");

        // Optimistic Update
        const statusText = cardElement.querySelector('.device-status');
        const iconDiv = cardElement.querySelector('.device-icon');
        if(newState) {
            cardElement.classList.add('is-active');
            if(iconDiv) iconDiv.className = 'device-icon icon-on';
            if(statusText) { statusText.classList.replace('text-off', 'text-on'); statusText.innerText = "ON"; }
        } else {
            cardElement.classList.remove('is-active');
            if(iconDiv) iconDiv.className = 'device-icon icon-off';
            if(statusText) { statusText.classList.replace('text-on', 'text-off'); statusText.innerText = "OFF"; }
        }
    } catch (err) {
        if (err.name === 'AbortError') showToast("Timeout. Device may be offline.", "warning");
        else showToast("Connection Failed", "error");
    } finally {
        cardElement.classList.remove('card-loading');
        setTimeout(fetchDevices, 1000);
    }
}

function logout() {
    localStorage.removeItem('token');
    window.location.href = 'index.html';
}