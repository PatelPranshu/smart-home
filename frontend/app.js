// ==========================================
// 1. GLOBAL CONFIGURATION & ROUTER
// ==========================================

// Determine API URL (Localhost vs Render)
const API_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3000/api'
    : 'http://localhost:3000/api';

// Global State
const token = localStorage.getItem('token');
const path = window.location.pathname;

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
                window.location.href = 'home.html';
            } else if (data.status === 'ok') {
                alert("Account created! Please log in.");
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
        window.selectedType = type || 'light';

        document.getElementById('edit-name').value = name;
        document.getElementById('timer-hrs').value = "";
        document.getElementById('timer-mins').value = "";

        // Highlight Icon
        document.querySelectorAll('.type-option').forEach(el => el.classList.remove('selected'));
        const activeOption = document.querySelector(`.type-option[data-type="${window.selectedType}"]`);
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
        } catch (err) { alert("Failed to save"); }
    };

    window.setTimer = async () => {
        const hrs = parseInt(document.getElementById('timer-hrs').value) || 0;
        const mins = parseInt(document.getElementById('timer-mins').value) || 0;
        if (hrs === 0 && mins === 0) return alert("Enter time");

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
        } catch (err) { alert("Failed to set timer"); }
    };
}


// ==========================================
// 4. PAGE: ENERGY / HISTORY (energy.html)
// ==========================================
async function initEnergy() {
    const list = document.getElementById('history-list');
    
    async function loadHistory() {
        try {
            const res = await fetch(`${API_URL}/devices`, { headers: { 'x-access-token': token } });
            const devices = await res.json();
            
            list.innerHTML = ''; // Clear loading text

            devices.forEach(device => {
                device.switches.forEach(sw => {
                    const item = document.createElement('div');
                    item.className = 'history-item'; // Defined in CSS
                    
                    // Logic for time display
                    let timeStr = "No recent activity";
                    if (sw.state) {
                         // If ON, show runtime
                         if(sw.lastOnTime) {
                            const diff = Math.floor((new Date() - new Date(sw.lastOnTime))/60000);
                            timeStr = `Running for ${diff} mins`;
                         }
                    } else {
                        // If OFF, check if it was on recently
                        if(sw.lastOnTime) {
                            timeStr = `Last used: ${new Date(sw.lastOnTime).toLocaleTimeString()}`;
                        }
                    }

                    // Check for active timer
                    let timerBadge = "";
                    if(sw.state && sw.timerExpiresAt) {
                        const timeLeft = Math.ceil((new Date(sw.timerExpiresAt) - new Date())/60000);
                        if(timeLeft > 0) timerBadge = `<span style="font-size:0.7rem; background:#fef08a; padding:2px 6px; border-radius:4px; color:#854d0e;">Turns off in ${timeLeft}m</span>`;
                    }

                    item.innerHTML = `
                        <div style="display:flex; align-items:center; gap:15px;">
                            <div class="device-icon" style="width:40px; height:40px; font-size:1.2rem; display:flex; align-items:center; justify-content:center; background:#f3f4f6; border-radius:50%;">
                                <i class="fa-solid ${typeIcons[sw.type || 'light']}"></i>
                            </div>
                            <div>
                                <div style="font-weight:600; color:#333;">${sw.name}</div>
                                <div style="font-size:0.8rem; color:#666;">${timeStr}</div>
                                ${timerBadge}
                            </div>
                        </div>
                        <div style="font-weight:700; color:${sw.state ? '#22c55e' : '#ef4444'};">
                            ${sw.state ? 'ON' : 'OFF'}
                        </div>
                    `;
                    item.style.cssText = "display: flex; justify-content: space-between; align-items: center; background: white; padding: 15px; border-radius: 12px; margin-bottom: 10px; box-shadow: 0 2px 5px rgba(0,0,0,0.05);";
                    list.appendChild(item);
                });
            });

        } catch(err) {
            list.innerText = "Failed to load history.";
        }
    }

    loadHistory();
    // Refresh history every 5 seconds
    setInterval(loadHistory, 5000); 
}


// ==========================================
// 5. PAGE: SETTINGS (settings.html)
// ==========================================
async function initSettings() {
    // 1. Load User Info (Simulated)
    document.getElementById('user-email-display').innerText = "Logged In User"; 

    // 2. Populate Device Dropdown
    const select = document.getElementById('device-select');
    try {
        const res = await fetch(`${API_URL}/devices`, { headers: { 'x-access-token': token } });
        const devices = await res.json();
        
        select.innerHTML = '';
        if(devices.length === 0) {
            select.innerHTML = '<option>No devices found</option>';
        }
        devices.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d.deviceId;
            opt.innerText = `ESP32 Device (${d.deviceId})`;
            select.appendChild(opt);
        });
    } catch(err) {
        select.innerHTML = '<option>Error loading devices</option>';
    }

    // 3. Settings Actions
    window.updateUserAccount = async () => {
        const newPass = document.getElementById('new-password').value;
        if(!newPass) return alert("Please enter a new password");
        
        try {
            const res = await fetch(`${API_URL}/user-update`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-access-token': token },
                body: JSON.stringify({ password: newPass }) // Backend handles finding user by Token
            });
            if(res.ok) {
                alert("Password updated! Please log in again.");
                logout();
            } else {
                alert("Update failed.");
            }
        } catch(err) { alert("Server Error"); }
    };

    window.updateWifiSettings = async () => {
        const deviceId = document.getElementById('device-select').value;
        const ssid = document.getElementById('wifi-ssid').value;
        const pass = document.getElementById('wifi-pass').value;

        if(!ssid || !pass) return alert("Enter SSID and Password");
        if(!confirm("Device will restart. Continue?")) return;

        try {
            const res = await fetch(`${API_URL}/wifi-config`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-access-token': token },
                body: JSON.stringify({ deviceId, ssid, pass })
            });
            const data = await res.json();
            if(res.ok) alert("Wi-Fi credentials sent!");
            else alert("Error: " + data.error);
        } catch(err) { alert("Failed to send"); }
    };
}


// ==========================================
// 6. SHARED HELPERS (Used by Home & Energy)
// ==========================================

async function fetchDevices() {
    // Only runs if on Home or Energy page
    const grid = document.getElementById('device-grid');
    if (!grid) return; // Safety check

    try {
        const res = await fetch(`${API_URL}/devices`, { headers: { 'x-access-token': token } });
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
        if (err.name === 'AbortError') alert("Timeout. Device may be offline.");
        else alert("Connection Failed.");
    } finally {
        cardElement.classList.remove('card-loading');
        setTimeout(fetchDevices, 1000);
    }
}

function logout() {
    localStorage.removeItem('token');
    window.location.href = 'index.html';
}