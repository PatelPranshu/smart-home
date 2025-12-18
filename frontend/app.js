const API_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:5000/api'
    : 'https://smarthome-backend-rbmc.onrender.com/api';

// --- DOM REFS ---
const loginView = document.getElementById('login-view');
const dashboardView = document.getElementById('dashboard-view');
const loginForm = document.getElementById('login-form');
const deviceGrid = document.getElementById('device-grid');
const errorMsg = document.getElementById('auth-msg');

// --- INIT ---
const dateOptions = { weekday: 'long', month: 'long', day: 'numeric' };
document.getElementById('date-display').innerText = new Date().toLocaleDateString('en-US', dateOptions);

// Check if user is already logged in
let token = localStorage.getItem('token');
if (token) {
    showDashboard();
}

// --- AUTHENTICATION ---
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    try {
        const res = await fetch(`${API_URL}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        
        const data = await res.json();
        
        if (data.token) {
            token = data.token;
            localStorage.setItem('token', token);
            errorMsg.classList.add('hidden');
            showDashboard();
        } else {
            errorMsg.innerText = data.error || "Login Failed";
            errorMsg.classList.remove('hidden');
        }
    } catch (err) {
        errorMsg.innerText = "Server Error. Is backend running?";
        errorMsg.classList.remove('hidden');
    }
});

function logout() {
    localStorage.removeItem('token');
    location.reload();
}

function showDashboard() {
    loginView.classList.add('hidden');
    dashboardView.classList.remove('hidden');
    dashboardView.classList.add('fade-in');
    fetchDevices();
}

// --- CORE DEVICE LOGIC ---

// Helper: Pick icon based on name
function getIconForName(name) {
    const lower = name.toLowerCase();
    if (lower.includes('light') || lower.includes('lamp')) return 'fa-lightbulb';
    if (lower.includes('fan')) return 'fa-fan';
    if (lower.includes('ac') || lower.includes('conditioner')) return 'fa-snowflake';
    if (lower.includes('tv') || lower.includes('television')) return 'fa-tv';
    if (lower.includes('lock')) return 'fa-lock';
    return 'fa-power-off'; // Default
}

async function fetchDevices() {
    try {
        const res = await fetch(`${API_URL}/devices`, {
            headers: { 'x-access-token': token }
        });
        
        // Backend returns array of Devices. Each Device has array of Switches.
        // We need to flatten this for the UI grid.
        const devices = await res.json();
        renderGrid(devices);
    } catch (err) {
        console.error("Error fetching devices", err);
    }
}

// --- ICON MAPPING ---
// --- ICON MAPPING ---
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

function renderGrid(devices) {
    devices.forEach(device => {
        // CHECK ONLINE STATUS
        const isOnline = device.isOnline; // True or False

        device.switches.forEach(sw => {
            const domId = `card-${device.deviceId}-${sw.id}`;
            let card = document.getElementById(domId);
            
            // Get fresh data
            const dbType = sw.type || 'light'; 
            const iconClass = typeIcons[dbType] || 'fa-power-off';

            // --- TIME CALCULATIONS ---
            let runtimeText = "";
            let timerText = "";

            // Only calculate time if the device is ON and ONLINE
            if (isOnline && sw.state && sw.lastOnTime) {
                const diffMs = new Date() - new Date(sw.lastOnTime);
                const mins = Math.floor(diffMs / 60000);
                const hrs = Math.floor(mins / 60);
                if (hrs > 0) runtimeText = `${hrs}h ${mins % 60}m`;
                else runtimeText = `${mins} mins`;
            }

            if (isOnline && sw.state && sw.timerExpiresAt) {
                const timeLeftMs = new Date(sw.timerExpiresAt) - new Date();
                if (timeLeftMs > 0) {
                    const minsLeft = Math.ceil(timeLeftMs / 60000);
                    timerText = `${minsLeft}m left`;
                }
            }

            // --- 1. CREATE CARD (If needed) ---
            if (!card) {
                card = document.createElement('div');
                card.id = domId;
                
                card.innerHTML = `
                    <div class="offline-overlay hidden">
                        <i class="fa-solid fa-wifi"></i>
                        <span>Disconnected</span>
                    </div>

                    <div class="card-options">
                        <i class="fa-solid fa-ellipsis-vertical"></i>
                    </div>

                    <div class="card-header">
                        <div class="device-icon">
                            <i class="fa-solid ${iconClass}"></i>
                            <div class="spinner"></div>
                        </div>
                    </div>
                    
                    <div class="card-footer">
                        <div class="footer-left">
                            <div class="device-name">${sw.name}</div>
                            <div class="device-status">OFF</div>
                        </div>
                        <div class="footer-right">
                             <div class="runtime-display"></div>
                             <div class="timer-display"></div>
                        </div>
                    </div>
                `;
                deviceGrid.appendChild(card);
            }

            // --- 2. HANDLE OFFLINE STATE ---
            const overlay = card.querySelector('.offline-overlay');
            
            if (!isOnline) {
                // Device is OFFLINE
                // We append 'device-offline' but keep 'device-card' base class
                card.classList.add('device-offline'); 
                overlay.classList.remove('hidden');   
                card.onclick = null; // Disable clicking
            } else {
                // Device is ONLINE
                card.classList.remove('device-offline');
                overlay.classList.add('hidden');
                
                // Re-enable clicking (only if not currently loading)
                if (!card.classList.contains('card-loading')) {
                    card.onclick = () => toggleDevice(device.deviceId, sw.id, !sw.state, card);
                }
            }

            // --- 3. ALWAYS UPDATE LISTENERS ---
            // Update "Three Dots" Click Event with FRESH data
            const optionsBtn = card.querySelector('.card-options');
            if(optionsBtn) {
                optionsBtn.onclick = (e) => {
                    e.stopPropagation(); 
                    if(isOnline) openModal(device.deviceId, sw.id, sw.name, dbType);
                };
            }

            // --- 4. LIVE VISUAL UPDATES ---
            
            // Update Name
            const nameEl = card.querySelector('.device-name');
            if(nameEl) nameEl.innerText = sw.name;

            // Update Icon (Only if NOT loading to prevent flicker)
            const iconEl = card.querySelector('.device-icon i');
            if(iconEl && !card.classList.contains('card-loading')) {
                iconEl.className = `fa-solid ${iconClass}`;
            }

            // Update Time Texts
            const runtimeDiv = card.querySelector('.runtime-display');
            const timerDiv = card.querySelector('.timer-display');
            
            if (runtimeDiv) {
                runtimeDiv.innerText = runtimeText;
                runtimeDiv.style.display = runtimeText ? 'block' : 'none';
            }
            if (timerDiv) {
                timerDiv.innerText = timerText;
                timerDiv.style.display = timerText ? 'block' : 'none';
            }

            // Update ON/OFF Colors (Only if NOT loading)
            if (!card.classList.contains('card-loading')) {
                const isActive = sw.state; 
                const statusText = card.querySelector('.device-status');
                const iconDiv = card.querySelector('.device-icon');

                // Base class logic
                let baseClass = 'device-card';
                if (!isOnline) baseClass += ' device-offline';
                else if (isActive) baseClass += ' is-active';

                card.className = baseClass;

                if (isActive) {
                    if(iconDiv) iconDiv.className = `device-icon icon-on`;
                    if(statusText) {
                        statusText.className = 'device-status text-on';
                        statusText.innerText = 'ON';
                    }
                } else {
                    if(iconDiv) iconDiv.className = `device-icon icon-off`;
                    if(statusText) {
                        statusText.className = 'device-status text-off';
                        statusText.innerText = 'OFF';
                    }
                }
            }
        });
    });
}
// --- TOGGLE FUNCTION (FIXED: No Dot Error) ---
async function toggleDevice(deviceId, switchId, newState, cardElement) {
    // 1. START LOADING ANIMATION
    cardElement.classList.add('card-loading');

    // Create a Timeout Controller (Stops request after 5 seconds)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
        // 2. SEND REQUEST (With Timeout)
        const response = await fetch(`${API_URL}/control`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'x-access-token': token
            },
            body: JSON.stringify({ deviceId, switchId, state: newState }),
            signal: controller.signal // <--- Connects the timeout
        });
        
        // Clear timeout since request finished
        clearTimeout(timeoutId); 

        // 3. CHECK FOR SERVER ERRORS
        if (!response.ok) {
            throw new Error(`Server Error: ${response.status}`);
        }

        // 4. UPDATE UI (Only if successful)
        // Manually flip the classes so user sees result instantly
        const statusText = cardElement.querySelector('.device-status');
        const iconDiv = cardElement.querySelector('.device-icon');

        if(newState) {
            cardElement.classList.add('is-active');
            if(iconDiv) iconDiv.className = 'device-icon icon-on';
            if(statusText) {
                statusText.classList.replace('text-off', 'text-on');
                statusText.innerText = "ON";
            }
        } else {
            cardElement.classList.remove('is-active');
            if(iconDiv) iconDiv.className = 'device-icon icon-off';
            if(statusText) {
                statusText.classList.replace('text-on', 'text-off');
                statusText.innerText = "OFF";
            }
        }

    } catch (err) {
        console.error("Toggle failed:", err);
        
        // Specific error message for timeout
        if (err.name === 'AbortError') {
            alert("Request timed out. Device may be offline.");
        } else {
            alert("Connection Failed. Please try again.");
        }
        // We do NOT update the UI here, so it reverts to original state

    } finally {
        // 5. STOP LOADING (This ALWAYS runs, success or fail)
        cardElement.classList.remove('card-loading');
        
        // Trigger background sync just to be safe
        setTimeout(fetchDevices, 1000);
    }
}
// --- AUTH UI TOGGLE ---
function toggleAuth(view) {
    document.getElementById('auth-msg').classList.add('hidden');
    if (view === 'register') {
        document.getElementById('login-form').classList.add('hidden');
        document.getElementById('register-form').classList.remove('hidden');
    } else {
        document.getElementById('register-form').classList.add('hidden');
        document.getElementById('login-form').classList.remove('hidden');
    }
}

// --- REGISTER LOGIC ---
document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('reg-email').value;
    const password = document.getElementById('reg-password').value;
    const msg = document.getElementById('auth-msg');

    try {
        const res = await fetch(`${API_URL}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        
        const data = await res.json();
        
        if (data.status === 'ok') {
            alert("Account created! Please log in.");
            toggleAuth('login');
        } else {
            msg.innerText = data.error || "Registration Failed";
            msg.classList.remove('hidden');
        }
    } catch (err) {
        msg.innerText = "Server Error";
        msg.classList.remove('hidden');
    }
});

// --- REAL-TIME SYNC ---
// Poll the server every 2 seconds to check for manual switch changes
setInterval(() => {
    // Only fetch if logged in and dashboard is visible
    if (token && !dashboardView.classList.contains('hidden')) {
        fetchDevices();
    }
}, 2000);


// --- MODAL & EDIT LOGIC ---
let currentDeviceId = null;
let currentSwitchId = null;
let selectedType = 'light';

function openModal(deviceId, switchId, name, type) {
    currentDeviceId = deviceId;
    currentSwitchId = switchId;
    
    // Default to 'light' if type is missing/null
    selectedType = type || 'light';

    // 1. Fill Name Input
    document.getElementById('edit-name').value = name;
    
    // 2. Clear previous inputs
    document.getElementById('timer-hrs').value = "";
    document.getElementById('timer-mins').value = "";

    // 3. Highlight the Correct Icon (THE FIX)
    // First, remove blue border from everyone
    document.querySelectorAll('.type-option').forEach(el => el.classList.remove('selected'));
    
    // Second, find the element matching our type and add blue border
    const activeOption = document.querySelector(`.type-option[data-type="${selectedType}"]`);
    if (activeOption) {
        activeOption.classList.add('selected');
    }

    // 4. Show Modal
    document.getElementById('edit-modal').classList.remove('hidden');
}

function closeModal() {
    document.getElementById('edit-modal').classList.add('hidden');
}

function selectType(type) {
    selectedType = type;
    // Update visual selection
    document.querySelectorAll('.type-option').forEach(el => el.classList.remove('selected'));
    event.currentTarget.classList.add('selected');
}

async function saveChanges() {
    const newName = document.getElementById('edit-name').value;
    
    try {
        await fetch(`${API_URL}/edit`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'x-access-token': token
            },
            body: JSON.stringify({ 
                deviceId: currentDeviceId, 
                switchId: currentSwitchId,
                newName: newName,
                newType: selectedType
            })
        });
        
        closeModal();
        fetchDevices(); // Refresh Grid to show new Name/Icon
    } catch (err) {
        alert("Failed to save");
    }
}

async function setTimer() {
    // 1. Get values from both inputs
    const hrsInput = document.getElementById('timer-hrs').value;
    const minsInput = document.getElementById('timer-mins').value;

    // 2. Convert to numbers (Default to 0 if empty)
    const hrs = parseInt(hrsInput) || 0;
    const mins = parseInt(minsInput) || 0;

    // 3. Validation
    if (hrs === 0 && mins === 0) {
        return alert("Please enter a valid time (Hours or Minutes).");
    }

    // 4. Calculate Total Minutes for the backend
    const totalMinutes = (hrs * 60) + mins;

    try {
        await fetch(`${API_URL}/timer`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'x-access-token': token
            },
            body: JSON.stringify({ 
                deviceId: currentDeviceId, 
                switchId: currentSwitchId,
                minutes: totalMinutes // Backend still expects total minutes
            })
        });
        
        // alert(`Timer set for ${hrs}h ${mins}m`);
        closeModal();
        
        // Refresh grid to show the yellow countdown immediately
        fetchDevices(); 

    } catch (err) {
        console.error(err);
        alert("Failed to set timer");
    }
}