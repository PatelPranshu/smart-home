// ==========================================
// 1. GLOBAL CONFIGURATION & ROUTER
// ==========================================

// Determine API URL (Localhost vs Render)
// const API_URL = 'http://localhost:3000/api';
const API_URL = 'https://smart-home-04m4.onrender.com/api';

// Global State
const token = localStorage.getItem('token');
const path = window.location.pathname;

// GLOBAL FETCH INTERCEPTOR
const originalFetch = window.fetch;
window.fetch = async function () {
    const response = await originalFetch.apply(this, arguments);
    if (response.status === 401) {
        localStorage.removeItem('token');
        if (!window.location.pathname.endsWith('index.html') && window.location.pathname !== '/') {
            window.location.href = 'index.html';
        }
    }
    return response;
};

// ==========================================
// 0. TOAST NOTIFICATION SYSTEM
// ==========================================
const style = document.createElement('style');
style.innerHTML = `
  .toast-container { position: fixed; top: 20px; right: 20px; z-index: 10000; display: flex; flex-direction: column; gap: 10px; color: #111111ff; }
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

    let icon = 'fa-circle-info';
    if (type === 'success') icon = 'fa-circle-check';
    if (type === 'error') icon = 'fa-circle-exclamation';
    if (type === 'warning') icon = 'fa-triangle-exclamation';

    toast.innerHTML = `<i class="fa-solid ${icon}" style="margin-right:12px; font-size:1.3rem;"></i> <span>${message}</span>`;
    container.appendChild(toast);

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
    'outlet': 'fa-plug',
    'wifi': 'fa-wifi',
    'water': 'fa-faucet-drip',
    'laundry': 'fa-shirt',
    'other': 'fa-bolt'
};

// --- ROUTER ---
document.addEventListener('DOMContentLoaded', () => {
    // Auth Checks
    if (!token && !path.endsWith('index.html') && path !== '/') {
        window.location.href = 'index.html';
        return;
    }
    if (token && (path.endsWith('index.html') || path === '/')) {
        window.location.href = 'home.html';
        return;
    }

    // Initialize Pages
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

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        await handleAuth('/login', { email, password });
    });

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
                // Save Token
                localStorage.setItem('token', data.token);
                localStorage.setItem('userEmail', body.email);

                // --- FIX START: Smart Redirection ---
                if (data.role === 'admin') {
                    window.location.href = 'admin.html';
                } else {
                    window.location.href = 'home.html';
                }
                // --- FIX END ---

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
async function initHome() {
    const dateOptions = { weekday: 'long', month: 'long', day: 'numeric' };
    document.getElementById('date-display').innerText = new Date().toLocaleDateString('en-US', dateOptions);

    // --- Fetch Custom Title ---
    try {
        const res = await fetch(`${API_URL}/user/profile`, { headers: { 'x-access-token': token } });
        const data = await res.json();
        if (data.homeTitle) {
            document.getElementById('dashboard-title').innerText = data.homeTitle;
        }
    } catch (err) { console.error("Failed to load title"); }


    fetchDevices();
    setInterval(fetchDevices, 2000);

    window.currentDeviceId = null;
    window.currentSwitchId = null;
    window.selectedType = 'light';
    window.timerInterval = null; // Store interval ID to clear it later

    // --- UPDATED: Open Modal Logic ---
    window.openModal = (deviceId, switchId, name, type) => {
        window.currentDeviceId = deviceId;
        window.currentSwitchId = switchId;
        window.selectedType = (type || 'light').toLowerCase();

        document.getElementById('edit-name').value = name;

        // 1. Reset UI State
        document.getElementById('timer-hrs').value = "";
        document.getElementById('timer-mins').value = "";

        document.querySelectorAll('.type-option').forEach(el => el.classList.remove('selected'));
        let activeOption = document.querySelector(`.type-option[data-type="${window.selectedType}"]`);
        if (!activeOption) {
            window.selectedType = 'light';
            activeOption = document.querySelector(`.type-option[data-type="light"]`);
        }
        if (activeOption) activeOption.classList.add('selected');

        // 2. CHECK FOR ACTIVE TIMER
        const device = window.allDevices.find(d => d.deviceId === deviceId);
        const sw = device ? device.switches.find(s => s.id === switchId) : null;

        const inputUI = document.getElementById('timer-input-ui');
        const activeUI = document.getElementById('timer-active-ui');
        const countdownEl = document.getElementById('timer-countdown');

        // Clear any previous interval
        if (window.timerInterval) clearInterval(window.timerInterval);

        if (sw && sw.timerExpiresAt && new Date(sw.timerExpiresAt) > new Date()) {
            // SHOW Active Timer UI
            inputUI.classList.add('hidden');
            activeUI.classList.remove('hidden');

            // Function to update countdown text
            const updateTime = () => {
                const diff = new Date(sw.timerExpiresAt) - new Date();
                if (diff <= 0) {
                    // Timer finished while modal open -> Switch to input view
                    inputUI.classList.remove('hidden');
                    activeUI.classList.add('hidden');
                    clearInterval(window.timerInterval);
                } else {
                    const m = Math.ceil((diff / 1000 / 60) % 60);
                    const h = Math.floor((diff / 1000 / 60 / 60));
                    countdownEl.innerText = h > 0 ? `${h}h ${m}m left` : `${m}m left`;
                }
            };

            updateTime(); // Run immediately
            window.timerInterval = setInterval(updateTime, 1000); // Update every second

        } else {
            // SHOW Input UI
            inputUI.classList.remove('hidden');
            activeUI.classList.add('hidden');
        }

        // 3. FAN SPEED SECTION: show only if type is fan
        const fanSection = document.getElementById('fan-speed-section');
        const fanSlider = document.getElementById('modal-fan-speed');
        const fanLabel = document.getElementById('modal-speed-label');
        const speedNames = ['', 'Low', 'Medium', 'High', 'Turbo'];
        window.currentFanSpeed = (sw && sw.speed) ? sw.speed : 1;

        if (fanSection) {
            if (window.selectedType === 'fan') {
                fanSection.classList.remove('hidden');
                if (fanSlider) fanSlider.value = window.currentFanSpeed;
                if (fanLabel) fanLabel.innerText = speedNames[window.currentFanSpeed] || 'Low';
            } else {
                fanSection.classList.add('hidden');
            }

            if (fanSlider) {
                // Replace handler each time modal opens
                fanSlider.oninput = () => {
                    window.currentFanSpeed = parseInt(fanSlider.value);
                    if (fanLabel) fanLabel.innerText = speedNames[window.currentFanSpeed] || '';
                };
            }
        }

        document.getElementById('edit-modal').classList.remove('hidden');
    };

    // --- UPDATED: Close Modal ---
    window.closeModal = () => {
        if (window.timerInterval) clearInterval(window.timerInterval); // Stop counting
        document.getElementById('edit-modal').classList.add('hidden');
    };

    window.selectType = (type) => {
        window.selectedType = type;
        document.querySelectorAll('.type-option').forEach(el => el.classList.remove('selected'));
        event.currentTarget.classList.add('selected');

        // Show fan speed slider only for fan type
        const fanSection = document.getElementById('fan-speed-section');
        if (fanSection) {
            fanSection.classList.toggle('hidden', type !== 'fan');
        }
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

            // If fan type, also apply the selected speed
            if (window.selectedType === 'fan' && window.currentFanSpeed) {
                await setFanSpeed(window.currentDeviceId, window.currentSwitchId, window.currentFanSpeed, null);
            }

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
            showToast("Timer set successfully", "success");
        } catch (err) { showToast("Failed to set timer", "error"); }
    };

    // --- NEW: Cancel Timer Function ---
    window.cancelTimer = async () => {
        try {
            const res = await fetch(`${API_URL}/timer/cancel`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-access-token': token },
                body: JSON.stringify({
                    deviceId: window.currentDeviceId,
                    switchId: window.currentSwitchId
                })
            });

            if (res.ok) {
                // Switch UI back to Input Mode immediately
                document.getElementById('timer-active-ui').classList.add('hidden');
                document.getElementById('timer-input-ui').classList.remove('hidden');
                if (window.timerInterval) clearInterval(window.timerInterval);

                showToast("Timer Cancelled", "success");
                fetchDevices(); // Refresh data
            } else {
                showToast("Failed to cancel timer", "error");
            }
        } catch (err) {
            showToast("Server Error", "error");
        }
    };
}


// ==========================================
// 4. PAGE: ENERGY / HISTORY (energy.html)
// ==========================================
async function initEnergy() {
    const list = document.getElementById('history-list');

    async function loadHistory() {
        try {
            const res = await fetch(`${API_URL}/history?t=${Date.now()}`, {
                headers: { 'x-access-token': token },
                cache: 'no-store'
            });

            if (!res.ok) throw new Error(`Server Error: ${res.status}`);

            const logs = await res.json();

            list.innerHTML = '';

            if (!Array.isArray(logs) || logs.length === 0) {
                const emptyMsg = document.createElement('p');
                emptyMsg.style.cssText = 'text-align:center; color:#999; margin-top:20px;';
                emptyMsg.textContent = 'No activity in the last 24 hours.';
                list.appendChild(emptyMsg);
                return;
            }

            logs.forEach(log => {
                const item = document.createElement('div');
                item.className = 'history-item';
                item.style.cssText = "display: flex; justify-content: space-between; align-items: center; background: white; padding: 15px; border-radius: 12px; margin-bottom: 10px; box-shadow: 0 2px 5px rgba(0,0,0,0.05);";

                const timeStr = new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
                const dateStr = new Date(log.timestamp).toLocaleDateString();

                // --- FIX: Handle missing action safely ---
                const actionText = log.action || "Unknown Action";
                const isOne = actionText.includes("ON");
                // -----------------------------------------

                const color = isOne ? '#22c55e' : '#ef4444';
                const icon = isOne ? 'fa-toggle-on' : 'fa-toggle-off';

                // --- 1. Left Side (Icon + Text) ---
                const leftDiv = document.createElement('div');
                leftDiv.style.cssText = "display:flex; align-items:center; gap:15px;";

                // Icon Wrapper
                const iconDiv = document.createElement('div');
                iconDiv.style.cssText = `width:40px; height:40px; background:#f3f4f6; border-radius:50%; display:flex; align-items:center; justify-content:center; color:${color}; font-size:1.2rem;`;
                iconDiv.innerHTML = `<i class="fa-solid ${icon}"></i>`;

                // Text Wrapper
                const textDiv = document.createElement('div');

                // Device Name (SECURE)
                const nameEl = document.createElement('div');
                nameEl.style.cssText = "font-weight:600; color:#333;";
                nameEl.textContent = log.switchName || "Unknown Device";

                // Action Text (SECURE)
                const actionEl = document.createElement('div');
                actionEl.style.cssText = "font-size:0.8rem; color:#666;";
                actionEl.textContent = actionText;

                textDiv.appendChild(nameEl);
                textDiv.appendChild(actionEl);
                leftDiv.appendChild(iconDiv);
                leftDiv.appendChild(textDiv);

                // --- 2. Right Side (Time + Date) ---
                const rightDiv = document.createElement('div');
                rightDiv.style.textAlign = 'right';

                const timeEl = document.createElement('div');
                timeEl.style.cssText = "font-weight:700; font-size:0.9rem; color:#333;";
                timeEl.textContent = timeStr;

                const dateEl = document.createElement('div');
                dateEl.style.cssText = "font-size:0.7rem; color:#9ca3af;";
                dateEl.textContent = dateStr;

                rightDiv.appendChild(timeEl);
                rightDiv.appendChild(dateEl);

                // --- 3. Assemble ---
                item.appendChild(leftDiv);
                item.appendChild(rightDiv);
                list.appendChild(item);
            });

        } catch (err) {
            console.error("History Load Error:", err);
            list.innerText = `Failed to load history. (${err.message})`;
        }
    }

    loadHistory();
    setInterval(loadHistory, 5000);
}


// ==========================================
// 5. PAGE: SETTINGS (settings.html)    
// ==========================================
async function initSettings() {
    const userEmail = localStorage.getItem('userEmail') || "User";
    document.getElementById('username-display').innerText = userEmail;

    // --- NEW: Load current title into input box ---
    try {
        const res = await fetch(`${API_URL}/user/profile`, { headers: { 'x-access-token': token } });
        const data = await res.json();
        if (document.getElementById('input-home-title')) {
            document.getElementById('input-home-title').value = data.homeTitle || "";
        }
    } catch (err) { }

    // --- NEW: Save Function ---
    window.saveHomeTitle = async () => {
        const newTitle = document.getElementById('input-home-title').value;
        if (!newTitle) return showToast("Title cannot be empty", "warning");

        try {
            const res = await fetch(`${API_URL}/user-update`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-access-token': token },
                body: JSON.stringify({ homeTitle: newTitle })
            });

            if (res.ok) showToast("Title Updated!", "success");
            else showToast("Update failed", "error");
        } catch (err) { showToast("Server Error", "error"); }
    };



    // --- NEW: Load Google Toggle State ---
    const toggleEl = document.getElementById('google-toggle');
    const sectionEl = document.getElementById('google-integration-section');
    try {
        const res = await fetch(`${API_URL}/user/google-status`, {
            headers: { 'x-access-token': token }
        });
        const data = await res.json();
        // Only show if linked
        if (data.isLinked) {
            if (sectionEl) sectionEl.style.display = 'block'; // Show it
            if (toggleEl) toggleEl.checked = data.enabled;
        } else {
            if (sectionEl) sectionEl.style.display = 'none'; // Keep hidden
        }
    } catch (err) { console.error("Failed to fetch google settings"); }

    // --- NEW: Handle Toggle Change ---
    window.toggleGoogleHome = async () => {
        const isEnabled = toggleEl.checked;
        try {
            await fetch(`${API_URL}/user/google-status`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-access-token': token },
                body: JSON.stringify({ enabled: isEnabled })
            });

            if (isEnabled) showToast("Google Home Enabled", "success");
            else showToast("Google Home Disabled (Devices will appear offline)", "warning");

        } catch (err) {
            showToast("Failed to update settings", "error");
            toggleEl.checked = !isEnabled; // Revert UI on error
        }
    };

    window.closeModals = () => {
        document.querySelectorAll('.modal-overlay').forEach(el => el.classList.add('hidden'));
    };

    // --- FLOW 0: CLAIM DEVICE (NEW ADDITION) ---
    window.openClaimModal = () => {
        // Clear previous inputs
        document.getElementById('claim-id').value = "";
        document.getElementById('claim-code').value = "";
        document.getElementById('modal-claim-device').classList.remove('hidden');
    };

    // SECURITY: Escape HTML special chars before injecting any DB value into innerHTML
    function escapeHtml(str) {
        if (str == null) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // --- NEW: Load User's Devices List ---
    async function loadSettingsDevices() {
        const container = document.getElementById('settings-device-list');
        if (!container) return;

        try {
            const res = await fetch(`${API_URL}/devices`, { headers: { 'x-access-token': token } });
            const devices = await res.json();

            container.innerHTML = '';

            if (devices.length === 0) {
                // Do not show empty text, just leave it empty so "Add Device" is the only item
                return;
            }

            devices.forEach(d => {
                const safeId = escapeHtml(d.deviceId);
                const item = document.createElement('div');
                item.className = 'list-item'; // Uses new CSS class

                const statusColor = d.isOnline ? '#22c55e' : '#ef4444';
                const statusText = d.isOnline ? 'Online' : 'Offline';

                item.innerHTML = `
                    <div class="btn-content">
                        <div class="icon-box gray">
                            <i class="fa-solid fa-microchip"></i>
                        </div>
                        <div class="list-info">
                            <span class="list-title">${safeId}</span>
                            <span class="list-sub">
                                <i class="fa-solid fa-circle" style="font-size:0.5rem; color:${statusColor}"></i> ${statusText}
                            </span>
                        </div>
                    </div>
                    <button class="btn-trash" onclick="initRemoveDevice('${safeId}')" title="Remove Device">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                `;
                container.appendChild(item);
            });

        } catch (err) {
            container.innerHTML = '<div style="padding:15px; color:red; text-align:center;">Error loading devices</div>';
        }
    }

    // Load immediately
    loadSettingsDevices();
    setInterval(loadSettingsDevices, 3000);


    // --- REMOVE DEVICE LOGIC ---
    window.deviceToRemove = null;

    // 1. Click Trash Icon -> Open Modal
    window.initRemoveDevice = (deviceId) => {
        window.deviceToRemove = deviceId;
        document.getElementById('input-remove-pass').value = "";
        document.getElementById('modal-remove-verify').classList.remove('hidden');
    };

    // 2. Click "Remove" in Modal -> Verify & Delete
    window.submitDeviceRemoval = async () => {
        const password = document.getElementById('input-remove-pass').value;

        if (!password) {
            showToast("Please enter your password", "warning");
            return;
        }

        try {
            // Step A: Verify Password
            const resVerify = await fetch(`${API_URL}/verify-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-access-token': token },
                body: JSON.stringify({ password })
            });

            if (!resVerify.ok) {
                showToast("Incorrect Password", "error");
                return;
            }

            // Step B: Remove Device
            const resRemove = await fetch(`${API_URL}/remove-device`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-access-token': token },
                body: JSON.stringify({ deviceId: window.deviceToRemove })
            });

            if (resRemove.ok) {
                showToast("Device Removed Successfully", "success");
                window.closeModals();
                loadSettingsDevices(); // Refresh List
            } else {
                showToast("Failed to remove device", "error");
            }
        } catch (err) {
            showToast("Server Error", "error");
        }
    };


    // --- UPDATE: Refresh list after adding a device ---
    window.submitClaimDevice = async () => {
        const deviceId = document.getElementById('claim-id').value.trim();
        const secretCode = document.getElementById('claim-code').value.trim();

        if (!deviceId || !secretCode) return showToast("Please fill all fields", "warning");

        try {
            const res = await fetch(`${API_URL}/claim-device`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-access-token': token },
                body: JSON.stringify({ deviceId, secretCode })
            });

            const data = await res.json();

            if (res.ok && data.status === 'success') {
                showToast("Device Added Successfully!", "success");
                window.closeModals();
                loadSettingsDevices(); // REFRESH LIST HERE
            } else {
                showToast(data.error || "Failed to add device", "error");
            }
        } catch (err) {
            showToast("Server Error", "error");
        }
    };


    // --- FLOW 1: CHANGE PASSWORD ---
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
                document.getElementById('modal-change-pass').classList.remove('hidden');
            } else {
                showToast("Invalid ESP32 Kit Code", "error");
            }
        } catch (err) { showToast("Verification Error", "error"); }
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


    // --- FLOW 2: CHANGE WI-FI ---
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
                await loadDevicesForWifi();
                document.getElementById('modal-wifi-settings').classList.remove('hidden');
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
        const ssid = document.getElementById('wifi-ssid').value.trim();
        const pass = document.getElementById('wifi-pass').value.trim();

        if (!ssid || !pass) return showToast("Please fill all fields", "warning");
        if (pass.length < 8) return showToast("Password too short", "warning");

        showToast("Sending configuration... Device will restart shortly.", "info");

        try {
            await fetch(`${API_URL}/wifi-config`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-access-token': token },
                body: JSON.stringify({ deviceId, ssid, pass })
            });

            setTimeout(() => {
                showToast("Wi-Fi Update Sent!", "success");
                window.closeModals();
            }, 1000);

        } catch (err) { showToast("Failed to send Wi-Fi settings", "error"); }
    };
}


// ==========================================
// 6. SHARED HELPERS
// ==========================================
async function fetchDevices() {
    const grid = document.getElementById('device-grid');
    if (!grid) return;

    try {
        const res = await fetch(`${API_URL}/devices?t=${Date.now()}`, {
            headers: { 'x-access-token': token },
            cache: 'no-store'
        });

        const devices = await res.json();

        // --- NEW: Store globally for the popup to use ---
        window.allDevices = devices;

        // --- UPDATED: Select device based on User Preference ---
        if (devices.length > 0) {
            let sensorDevice = null;

            // 1. Check if user has a preferred sensor saved
            const preferredId = localStorage.getItem('primarySensorId');
            if (preferredId) {
                sensorDevice = devices.find(d => d.deviceId === preferredId);
            }

            // 2. Fallback: If no preference, find first active one
            if (!sensorDevice) {
                sensorDevice = devices.find(d => d.temperature > 0 || d.humidity > 0) || devices[0];
            }

            const tempEl = document.getElementById('temp-display');
            const humEl = document.getElementById('hum-display');

            if (tempEl) tempEl.innerText = `${(sensorDevice.temperature || 0).toFixed(1)}°C`;
            if (humEl) humEl.innerText = `${(sensorDevice.humidity || 0).toFixed(0)}%`;
        }

        renderGrid(devices);
    } catch (err) { console.error("Fetch error", err); }
}

function renderGrid(devices) {
    const grid = document.getElementById('device-grid');
    if (!grid) return;


    // --- NEW: Global Offline Check ---
    // If we have devices, but ALL of them are offline, warn the user globally
    const allOffline = devices.length > 0 && devices.every(d => !d.isOnline);
    if (allOffline) {
        // You can use your existing showToast function
        // Debounce this so it doesn't spam (simple check)
        if (!window.hasShownOfflineToast) {
            showToast("⚠️ System Offline: Cannot reach Devices", "error");
            window.hasShownOfflineToast = true;
        }
    } else {
        window.hasShownOfflineToast = false;
    }

    devices.forEach(device => {
        const isOnline = device.isOnline;

        device.switches.forEach(sw => {
            const domId = `card-${device.deviceId}-${sw.id}`;
            let card = document.getElementById(domId);
            const dbType = sw.type || 'light';
            const iconClass = typeIcons[dbType] || 'fa-power-off';

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

            const overlay = card.querySelector('.offline-overlay');
            const optionsBtn = card.querySelector('.card-options');

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

            if (optionsBtn) {
                optionsBtn.onclick = (e) => {
                    e.stopPropagation();
                    if (isOnline && window.openModal) window.openModal(device.deviceId, sw.id, sw.name, dbType);
                };
            }

            const nameEl = card.querySelector('.device-name');
            if (nameEl) nameEl.innerText = sw.name;

            const iconEl = card.querySelector('.device-icon i');
            if (iconEl && !card.classList.contains('card-loading')) {
                // If offline, show broken link. If online, show device type.
                iconEl.className = isOnline ? `fa-solid ${iconClass}` : 'fa-solid fa-link-slash';
            }

            const runtimeDiv = card.querySelector('.runtime-display');
            const timerDiv = card.querySelector('.timer-display');
            if (runtimeDiv) { runtimeDiv.innerText = runtimeText; runtimeDiv.style.display = runtimeText ? 'block' : 'none'; }
            if (timerDiv) { timerDiv.innerText = timerText; timerDiv.style.display = timerText ? 'block' : 'none'; }

            if (!card.classList.contains('card-loading')) {
                const isActive = sw.state;
                const statusText = card.querySelector('.device-status');
                const iconDiv = card.querySelector('.device-icon');

                let baseClass = 'device-card';
                if (!isOnline) baseClass += ' device-offline';
                else if (isActive) baseClass += ' is-active';

                // If timerText has content, add the 'has-timer' class
                if (timerText) baseClass += ' has-timer';
                card.className = baseClass;

                if (iconDiv) iconDiv.className = isActive ? 'device-icon icon-on' : 'device-icon icon-off';
                if (statusText) {
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

        // --- NEW: Check for Rate Limit (429) ---
        if (response.status === 429) {
            showToast("⚠️ Too many requests! Please wait a moment.", "warning");
            return; // Stop here so UI doesn't update falsely
        }
        // ----------------------------------------

        if (!response.ok) throw new Error("Error");

        const statusText = cardElement.querySelector('.device-status');
        const iconDiv = cardElement.querySelector('.device-icon');
        if (newState) {
            cardElement.classList.add('is-active');
            if (iconDiv) iconDiv.className = 'device-icon icon-on';
            if (statusText) { statusText.classList.replace('text-off', 'text-on'); statusText.innerText = "ON"; }
        } else {
            cardElement.classList.remove('is-active');
            if (iconDiv) iconDiv.className = 'device-icon icon-off';
            if (statusText) { statusText.classList.replace('text-on', 'text-off'); statusText.innerText = "OFF"; }
        }
    } catch (err) {
        if (err.name === 'AbortError') showToast("Timeout. Device may be offline.", "warning");
        else showToast("Connection Failed", "error");
    } finally {
        cardElement.classList.remove('card-loading');
        setTimeout(fetchDevices, 1000);
    }
}

// Set fan speed (1=Low, 2=Med, 3=High, 4=Turbo)
async function setFanSpeed(deviceId, switchId, speed, cardElement) {
    // Optimistically update dots immediately for instant feedback
    const dots = cardElement ? cardElement.querySelectorAll('.speed-dot') : [];
    dots.forEach(d => d.classList.toggle('active', parseInt(d.dataset.speed) === speed));

    try {
        const res = await fetch(`${API_URL}/fan-speed`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-access-token': token },
            body: JSON.stringify({ deviceId, switchId, speed })
        });
        if (!res.ok) throw new Error('Failed');

        // Ensure card shows ON state visually
        if (cardElement) {
            cardElement.classList.add('is-active');
            const iconDiv = cardElement.querySelector('.device-icon');
            const statusEl = cardElement.querySelector('.device-status');
            if (iconDiv) iconDiv.className = 'device-icon icon-on';
            if (statusEl) { statusEl.className = 'device-status text-on'; statusEl.innerText = 'ON'; }
        }
    } catch (err) {
        showToast('Failed to set fan speed', 'error');
        dots.forEach(d => d.classList.remove('active'));
    }
}
function logout() {
    logoutThisDevice();
}

function openLogoutModal() {
    const modal = document.getElementById('modal-logout-options');
    if (modal) modal.classList.remove('hidden');
}

function closeLogoutModal() {
    const modal = document.getElementById('modal-logout-options');
    if (modal) modal.classList.add('hidden');
}

function logoutThisDevice() {
    localStorage.removeItem('token');
    window.location.href = 'index.html';
}

async function logoutAllDevices() {
    try {
        await fetch(`${API_URL}/logout-all`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-access-token': token }
        });
    } catch (err) {
        console.error("Logout all failed", err);
    } finally {
        logoutThisDevice();
    }
}

// ==========================================
// 7. SENSOR SELECTION POPUP LOGIC
// ==========================================

window.openSensorModal = () => {
    const modal = document.getElementById('sensor-modal');
    const list = document.getElementById('sensor-list');
    list.innerHTML = ''; // Clear previous list

    if (!window.allDevices || window.allDevices.length === 0) {
        list.innerHTML = '<p style="color:#666; text-align:center;">No devices found.</p>';
        modal.classList.remove('hidden');
        return;
    }

    const savedId = localStorage.getItem('primarySensorId');

    window.allDevices.forEach(d => {
        const item = document.createElement('label');
        item.style.cssText = "display: flex; justify-content: space-between; align-items: center; padding: 12px; background: #f9fafb; border-radius: 8px; cursor: pointer; border: 1px solid #eee;";

        const isChecked = (savedId === d.deviceId) ? 'checked' : '';

        item.innerHTML = `
            <div style="display:flex; flex-direction:column;">
                <span style="font-weight:600; color:#333;">${d.deviceId}</span>
                <span style="font-size:0.8rem; color:#666;">
                    <i class="fa-solid fa-temperature-half"></i> ${d.temperature}°C &nbsp;|&nbsp; 
                    <i class="fa-solid fa-droplet"></i> ${d.humidity}%
                </span>
            </div>
            <input type="radio" name="sensor_select" value="${d.deviceId}" ${isChecked} style="width:20px; height:20px;">
        `;
        list.appendChild(item);
    });

    modal.classList.remove('hidden');
};

window.saveSensorSelection = () => {
    const selected = document.querySelector('input[name="sensor_select"]:checked');
    if (selected) {
        localStorage.setItem('primarySensorId', selected.value);
        showToast("Main Sensor Updated", "success");
        closeSensorModal();
        fetchDevices(); // Refresh home page immediately
    } else {
        showToast("Please select a device", "warning");
    }
};

window.closeSensorModal = () => {
    const modal = document.getElementById('sensor-modal');
    if (modal) modal.classList.add('hidden');
};

// ... existing code ...

// =========================================
// VIEW TOGGLE LOGIC (LIST vs GRID)
// =========================================

// 1. Initialize View on Load — single listener only

// 2. Toggle Function
function setView(mode) {
    const gridContainer = document.getElementById('device-grid');
    const btnList = document.getElementById('btn-list');
    const btnGrid = document.getElementById('btn-grid');

    if (!gridContainer || !btnList || !btnGrid) return;

    // Reset State
    gridContainer.classList.remove('list-view');
    btnList.classList.remove('active');
    btnGrid.classList.remove('active');

    if (mode === 'list') {
        gridContainer.classList.add('list-view');
        btnList.classList.add('active');
    } else {
        btnGrid.classList.add('active');
    }

    localStorage.setItem('deviceViewMode', mode);
}

// BUG FIX: Removed duplicate DOMContentLoaded — was calling setView() twice on every page load
document.addEventListener('DOMContentLoaded', () => {
    setView(localStorage.getItem('deviceViewMode') || 'grid');
});