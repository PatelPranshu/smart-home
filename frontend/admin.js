// const API_URL = 'http://localhost:3000/api';
const API_URL = 'https://smart-home-04m4.onrender.com/api';

// SECURITY: Escape HTML special chars before injecting DB values into innerHTML
function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// [HARDWARE] Pin Map matching Firmware (GPIOs)
const PIN_MAP = [
    { r: 22, s: 15 }, // Relay 1 & Switch 1 (Matches Code Index 0)
    { r: 23, s: 16 }, // Relay 2 & Switch 2 (Matches Code Index 1)
    { r: 14, s: 17 }, // Relay 3 & Switch 3 (Matches Code Index 2)
    { r: 27, s: 5 }, // Relay 4 & Switch 4 (Matches Code Index 3)
    { r: 26, s: 18 }, // Relay 5 & Switch 5 (Matches Code Index 4)
    { r: 25, s: 19 }, // Relay 6 & Switch 6 (Matches Code Index 5)
    { r: 33, s: 21 }, // Relay 7 & Switch 7 (Matches Code Index 6)
    { r: 32, s: 34 }, // Relay 8 & Switch 8 (Matches Code Index 7)
    { r: 4, s: 35 }  // Relay 9 & Switch 9 (Matches Code Index 8)
];

// 1. Get Token
const token = localStorage.getItem('token');

// 2. CHECK AUTH ON LOAD
if (!token) {
    alert("You must log in as an Admin first.");
    window.location.href = 'index.html';
} else {
    // Hide auth overlay immediately if token exists
    const overlay = document.getElementById('auth-overlay');
    if (overlay) overlay.style.display = 'none';

    // Initialize Dashboard
    loadData();
}

// 3. LOAD DASHBOARD DATA
async function loadData() {
    try {
        // A. Fetch Stats
        const resStats = await fetch(`${API_URL}/admin/stats`, {
            headers: { 'x-access-token': token }
        });

        // Security Check
        if (resStats.status === 403) {
            alert("Access Denied: Your account is not an Admin.");
            window.location.href = 'home.html';
            return;
        }

        const stats = await resStats.json();
        document.getElementById('val-devices').innerText = stats.totalDevices || 0;
        document.getElementById('val-users').innerText = stats.totalUsers || 0;
        document.getElementById('val-online').innerText = stats.onlineDevices || 0;
        document.getElementById('val-unsold').innerText = stats.unownedDevices || 0;

        // B. Fetch Devices
        const resDev = await fetch(`${API_URL}/admin/devices`, {
            headers: { 'x-access-token': token }
        });
        const devices = await resDev.json();
        renderTable(devices);

    } catch (err) {
        console.error(err);
        // alert("Connection Error to Backend"); 
    }
}

// 4. RENDER TABLE (With New UI)
function renderTable(devices) {
    const tbody = document.getElementById('device-table-body');
    tbody.innerHTML = '';

    devices.forEach(dev => {
        const tr = document.createElement('tr');

        // Status Badge Logic
        const onlineBadge = dev.isOnline
            ? `<span class="badge online"><span class="badge-dot"></span>Online</span>`
            : `<span class="badge offline"><span class="badge-dot"></span>Offline</span>`;

        // Owner Display Logic
        const ownerDisplay = dev.owner
            ? `<span style="font-weight:600; color:#111827;">👤 ${dev.owner.email}</span>`
            : `<span style="color:#f59e0b; font-weight:600; font-size: 0.85rem; background: #fffbeb; padding: 2px 8px; border-radius: 4px; border: 1px solid #fcd34d;">Unsold</span>`;

        const safeDeviceId = escapeHtml(dev.deviceId);
        const safeSecretCode = escapeHtml(dev.secretCode);
        const safeEmail = dev.owner ? escapeHtml(dev.owner.email) : null;
        const channelCount = dev.switches ? dev.switches.length : 9;

        tr.innerHTML = `
            <td>${onlineBadge}</td>
            <td style="font-family:'Courier New', monospace; font-weight:600; color:#4b5563;">${safeDeviceId}</td>
            <td style="font-family:'Courier New', monospace; letter-spacing:1px;">${safeSecretCode}</td>
            <td>
                ${dev.owner
                ? `<span style="font-weight:600; color:#111827;">👤 ${safeEmail}</span>`
                : `<span style="color:#f59e0b; font-weight:600; font-size: 0.85rem; background: #fffbeb; padding: 2px 8px; border-radius: 4px; border: 1px solid #fcd34d;">Unsold</span>`}
                ${dev.owner ? `<div style="margin-top:4px;"><button onclick="unlinkUser('${safeDeviceId}')" style="font-size:0.75rem; color:#ef4444; border:none; background:none; cursor:pointer; text-decoration: underline;">Unlink User</button></div>` : ''}
            </td>
            <td style="text-align: right;">
                <button class="btn-small" style="background:#f59e0b; color:white;" onclick="openEditModal('${safeDeviceId}', ${channelCount})" title="Edit Channels"><i class="fa-solid fa-gear"></i></button>
                <button class="btn-small" style="background:#f59e0b; color:white;" onclick='openInvertModal(${JSON.stringify(dev)})' title="Fix Inverted Logic">
                    <i class="fa-solid fa-repeat"></i>
                </button>
                <button class="btn-small" style="background:#6366f1; color:white;" onclick="showPins(${channelCount})" title="View Pinout"><i class="fa-solid fa-microchip"></i></button>
                <button class="btn-small btn-qr" onclick='showQr(${JSON.stringify(dev)})' title="Get QR">
                    <i class="fa-solid fa-qrcode"></i>
                </button>
                <button class="btn-small btn-del" onclick="deleteDevice('${safeDeviceId}')" title="Delete"><i class="fa-solid fa-trash"></i></button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// 5. CREATE DEVICE LOGIC
function openCreateModal() {
    document.getElementById('new-secret-code').value = Math.floor(100000 + Math.random() * 900000);
    document.getElementById('create-modal').style.display = 'flex';
}

function closeCreateModal() {
    document.getElementById('create-modal').style.display = 'none';
}

async function submitCreateDevice() {
    const deviceId = document.getElementById('new-device-id').value;
    const secretCode = document.getElementById('new-secret-code').value;
    const channels = document.getElementById('new-channels').value; // Get channel count

    if (!deviceId) return alert("Device ID is required");

    try {
        const res = await fetch(`${API_URL}/admin/create`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-access-token': token
            },
            body: JSON.stringify({ deviceId, secretCode, channels }) // Send channels to backend
        });

        const data = await res.json();
        if (res.ok) {
            closeCreateModal();
            loadData();
            const tempDev = {
                deviceId,
                secretCode,
                switches: new Array(parseInt(channels)).fill({ inverted: false })
            };
            showQr(tempDev);
        } else {
            alert(data.error);
        }
    } catch (err) { alert("Error creating device"); }
}

// 6. EDIT CONFIGURATION LOGIC
function openEditModal(deviceId, currentChannels) {
    document.getElementById('edit-device-id').value = deviceId;
    document.getElementById('edit-channels').value = currentChannels;
    document.getElementById('edit-modal').style.display = 'flex';
}

async function submitEditChannels() {
    const deviceId = document.getElementById('edit-device-id').value;
    const channels = document.getElementById('edit-channels').value;

    try {
        const res = await fetch(`${API_URL}/admin/device/channels`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-access-token': token },
            body: JSON.stringify({ deviceId, channels })
        });

        if (res.ok) {
            document.getElementById('edit-modal').style.display = 'none';
            loadData();
        } else {
            alert("Update Failed");
        }
    } catch (err) { alert("Server Error"); }
}

// 7. UNLINK USER LOGIC
async function unlinkUser(id) {
    if (!confirm(`Remove user from ${id}? Device will be reset.`)) return;
    try {
        const res = await fetch(`${API_URL}/admin/unlink`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-access-token': token },
            body: JSON.stringify({ deviceId: id })
        });
        if (res.ok) loadData();
    } catch (err) { alert("Action failed"); }
}

// 8. DELETE DEVICE LOGIC
async function deleteDevice(id) {
    if (!confirm(`Permanently delete ${id}? This cannot be undone.`)) return;
    try {
        const res = await fetch(`${API_URL}/admin/device/${id}`, {
            method: 'DELETE',
            headers: { 'x-access-token': token }
        });
        if (res.ok) loadData();
    } catch (err) { alert("Delete failed"); }
}

// 9. DYNAMIC PINOUT DISPLAY
function showPins(count) {
    const tbody = document.getElementById('pin-table-body');
    tbody.innerHTML = '';

    // Only loop up to the specific device's channel count
    for (let i = 0; i < count; i++) {
        const pin = PIN_MAP[i];
        if (pin) {
            tbody.innerHTML += `
                <tr>
                    <td><b>${i + 1}</b></td>
                    <td>GPIO ${pin.r}</td>
                    <td>GPIO ${pin.s} ${i === 8 ? '<span style="color:#ef4444; font-size:0.7em;">(No Pullup)</span>' : ''}</td>
                </tr>`;
        }
    }
    document.getElementById('pin-modal').style.display = 'flex';
}

// 10. QR CODE LOGIC
// --- UPDATED renderTable line (Update only this button line) ---
// Change the showQr call to: onclick='showQr(${JSON.stringify(dev)})'

function showQr(dev) {
    const qrArea = document.getElementById('qr-print-area');
    const qrDiv = document.getElementById('qrcode');
    const qrText = document.getElementById('qr-text');
    const hardwareTable = document.getElementById('qr-hardware-table');

    if (!qrArea || !qrDiv || !hardwareTable) return;

    qrDiv.innerHTML = "";
    // SECURITY: Escape all DB-sourced values before injecting into HTML
    qrText.innerHTML = `
        <div style="font-size: 1.4rem; font-weight: bold; margin-bottom: 5px;">Device ID: ${escapeHtml(dev.deviceId)}</div>
        <div style="font-size: 1.2rem; color: #374151;">Secret Code: ${escapeHtml(dev.secretCode)}</div>
    `;

    const payload = JSON.stringify({ id: dev.deviceId, code: dev.secretCode });
    new QRCode(qrDiv, { text: payload, width: 120, height: 120 });

    const switches = dev.switches || [];
    const channelCount = switches.length > 0 ? switches.length : 9;

    // Build the restructured content
    let htmlContent = `
        <div style="text-align: left; font-family: sans-serif; margin-top: 20px;">
            
            <div style="background: #f3f4f6; padding: 8px; border-radius: 6px; margin-bottom: 15px; font-weight: 600;">
                Hardware Profile: ${channelCount} Relays / ${channelCount} Switches 
            </div>

            <div style="margin-bottom: 15px;">
                <strong>Active Sensors:</strong> 1 (DHT11 Temperature & Humidity) [cite: 9, 10]
            </div>

            <h4 style="font-size: 12px; margin-bottom: 5px; border-bottom: 1px solid #000;">4. Power Supply (ESP32)</h4>
            <table style="width:100%; border-collapse: collapse; font-size: 10px; margin-bottom: 15px;">
                <tr style="background:#eee;">
                    <th style="border: 1px solid #000; padding: 4px;">Device</th>
                    <th style="border: 1px solid #000; padding: 4px;">Positive (+) Pin</th>
                    <th style="border: 1px solid #000; padding: 4px;">Negative (-) Pin</th>
                </tr>
                <tr>
                    <td style="border: 1px solid #000; padding: 4px;">ESP32 NodeMCU</td>
                    <td style="border: 1px solid #000; padding: 4px;">VIN / 5V </td>
                    <td style="border: 1px solid #000; padding: 4px;">GND </td>
                </tr>
            </table>

            <h4 style="font-size: 12px; margin-bottom: 5px; border-bottom: 1px solid #000;">5. Sensor Pin Connections</h4>
            <table style="width:100%; border-collapse: collapse; font-size: 10px; margin-bottom: 15px;">
                <tr style="background:#eee;">
                    <th style="border: 1px solid #000; padding: 4px;">Sensor Name</th>
                    <th style="border: 1px solid #000; padding: 4px;">Total Pins</th>
                    <th style="border: 1px solid #000; padding: 4px;">Sensor Pin</th>
                    <th style="border: 1px solid #000; padding: 4px;">Connect to ESP32</th>
                </tr>
                <tr>
                    <td rowspan="3" style="border: 1px solid #000; padding: 4px;">DHT11 </td>
                    <td rowspan="3" style="border: 1px solid #000; padding: 4px; text-align:center;">3 / 4</td>
                    <td style="border: 1px solid #000; padding: 4px;">VCC</td>
                    <td style="border: 1px solid #000; padding: 4px;">3.3V</td>
                </tr>
                <tr>
                    <td style="border: 1px solid #000; padding: 4px;">DATA</td>
                    <td style="border: 1px solid #000; padding: 4px;">GPIO 13 </td>
                </tr>
                <tr>
                    <td style="border: 1px solid #000; padding: 4px;">GND</td>
                    <td style="border: 1px solid #000; padding: 4px;">GND </td>
                </tr>
            </table>

            <h4 style="font-size: 12px; margin-bottom: 5px; border-bottom: 1px solid #000;">6. External Resistor Requirements</h4>
            <table style="width:100%; border-collapse: collapse; font-size: 10px; margin-bottom: 15px;">
                <tr style="background:#eee;">
                    <th style="border: 1px solid #000; padding: 4px;">Resistor Value</th>
                    <th style="border: 1px solid #000; padding: 4px;">ESP32 Pin 1</th>
                    <th style="border: 1px solid #000; padding: 4px;">ESP32 Pin 2 (Pull-Up)</th>
                </tr>
                <tr>
                    <td style="border: 1px solid #000; padding: 4px;">10K Ohm [cite: 13]</td>
                    <td style="border: 1px solid #000; padding: 4px;">GPIO 34 </td>
                    <td style="border: 1px solid #000; padding: 4px;">3.3V Pin</td>
                </tr>
                <tr>
                    <td style="border: 1px solid #000; padding: 4px;">10K Ohm [cite: 13]</td>
                    <td style="border: 1px solid #000; padding: 4px;">GPIO 35 [cite: 13]</td>
                    <td style="border: 1px solid #000; padding: 4px;">3.3V Pin</td>
                </tr>
            </table>

            <h4 style="font-size: 12px; margin-bottom: 5px; border-bottom: 1px solid #000;">7. Relay Module Connections</h4>
            <table style="width:100%; border-collapse: collapse; font-size: 10px; margin-bottom: 15px;">
                <tr style="background:#eee;">
                    <th style="border: 1px solid #000; padding: 4px;">Channel</th>
                    <th style="border: 1px solid #000; padding: 4px;">Relay VCC</th>
                    <th style="border: 1px solid #000; padding: 4px;">Relay GND</th>
                    <th style="border: 1px solid #000; padding: 4px;">IN Pin to ESP32</th>
                </tr>`;

    for (let i = 0; i < channelCount; i++) {
        htmlContent += `
            <tr>
                <td style="border: 1px solid #000; padding: 4px; font-weight:bold;">Relay ${i + 1}</td>
                <td style="border: 1px solid #000; padding: 4px;">5V</td>
                <td style="border: 1px solid #000; padding: 4px;">GND</td>
                <td style="border: 1px solid #000; padding: 4px;">GPIO ${PIN_MAP[i].r} </td>
            </tr>`;
    }

    htmlContent += `
            </table>

            <h4 style="font-size: 12px; margin-bottom: 5px; border-bottom: 1px solid #000;">8. Switch (Manual) Connections</h4>
            <table style="width:100%; border-collapse: collapse; font-size: 10px; margin-bottom: 15px;">
                <tr style="background:#eee;">
                    <th style="border: 1px solid #000; padding: 4px;">Channel</th>
                    <th style="border: 1px solid #000; padding: 4px;">Switch Pin 1</th>
                    <th style="border: 1px solid #000; padding: 4px;">Switch Pin 2</th>
                </tr>`;

    for (let i = 0; i < channelCount; i++) {
        htmlContent += `
            <tr>
                <td style="border: 1px solid #000; padding: 4px; font-weight:bold;">Switch ${i + 1}</td>
                <td style="border: 1px solid #000; padding: 4px;">GPIO ${PIN_MAP[i].s} </td>
                <td style="border: 1px solid #000; padding: 4px;">GND</td>
            </tr>`;
    }

    htmlContent += `
            </table>
            <p style="font-size: 9px; font-style: italic;">* Note: GPIO 34 & 35 do not have internal pull-ups. Resistor must bridge GPIO to 3.3V. [cite: 13]</p>
        </div>`;

    hardwareTable.innerHTML = htmlContent;
    qrArea.style.display = 'block';
}

function closeQr() {
    document.getElementById('qr-print-area').style.display = 'none';
}


// 13. LOGIC INVERSION UI FUNCTIONS
function openInvertModal(device) {
    const tbody = document.getElementById('invert-table-body');
    tbody.innerHTML = '';

    device.switches.forEach(sw => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>
                <div style="font-weight:600;">${escapeHtml(sw.name)}</div>
                <div style="font-size:0.7rem; color:#999;">ID: ${escapeHtml(String(sw.id))}</div>
            </td>
            <td style="text-align: right;">
                <label class="switch-toggle">
                    <input type="checkbox" ${sw.inverted ? 'checked' : ''} 
                        onchange="toggleInversion('${escapeHtml(device.deviceId)}', ${sw.id}, this.checked)">
                    <span class="slider"></span>
                </label>
            </td>
        `;
        tbody.appendChild(tr);
    });

    document.getElementById('invert-modal').style.display = 'flex';
}

async function toggleInversion(deviceId, switchId, isInverted) {
    try {
        const res = await fetch(`${API_URL}/admin/device/invert-logic`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-access-token': token
            },
            body: JSON.stringify({ deviceId, switchId, inverted: isInverted })
        });

        if (res.ok) {
            console.log(`Switch ${switchId} inversion set to ${isInverted}`);
            // Refresh main table data to keep current state in memory
            loadData();
        } else {
            alert("Failed to update inversion logic");
        }
    } catch (err) {
        alert("Server Error while updating logic");
    }
}

// 11. LOGOUT
function logout() {
    logoutThisDevice();
}

function openLogoutModal() {
    const modal = document.getElementById('logout-modal');
    if (modal) modal.style.display = 'flex';
}

function closeLogoutModal() {
    const modal = document.getElementById('logout-modal');
    if (modal) modal.style.display = 'none';
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

// 12. OVERLAY AUTH HANDLER (Optional if button exists)
function adminLogin() {
    // This button is just a visual trigger in the HTML
    // The actual auth check happens at the top of this file (Section 2)
    // If we are here, we are already logged in or the token is missing
    if (token) {
        document.getElementById('auth-overlay').style.display = 'none';
        loadData();
    } else {
        window.location.href = 'index.html';
    }
}