// const API_URL = 'http://localhost:3000/api';
const API_URL = 'https://smart-home-04m4.onrender.com/api';

// [HARDWARE] Pin Map matching Firmware (GPIOs)
const PIN_MAP = [
    { r: 22, s: 15 }, // Relay 1 & Switch 1 (Matches Code Index 0)
    { r: 23, s: 16 }, // Relay 2 & Switch 2 (Matches Code Index 1)
    { r: 14, s: 17 }, // Relay 3 & Switch 3 (Matches Code Index 2)
    { r: 27, s: 5  }, // Relay 4 & Switch 4 (Matches Code Index 3)
    { r: 26, s: 18 }, // Relay 5 & Switch 5 (Matches Code Index 4)
    { r: 25, s: 19 }, // Relay 6 & Switch 6 (Matches Code Index 5)
    { r: 33, s: 21 }, // Relay 7 & Switch 7 (Matches Code Index 6)
    { r: 32, s: 34 }, // Relay 8 & Switch 8 (Matches Code Index 7)
    { r: 4,  s: 35 }  // Relay 9 & Switch 9 (Matches Code Index 8)
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
    if(overlay) overlay.style.display = 'none';
    
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
        if(resStats.status === 403) {
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

    } catch(err) {
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

        // Dynamic Channel Count
        const channelCount = dev.switches ? dev.switches.length : 9;

        tr.innerHTML = `
            <td>${onlineBadge}</td>
            <td style="font-family:'Courier New', monospace; font-weight:600; color:#4b5563;">${dev.deviceId}</td>
            <td style="font-family:'Courier New', monospace; letter-spacing:1px;">${dev.secretCode}</td>
            <td>
                ${ownerDisplay}
                ${dev.owner ? `<div style="margin-top:4px;"><button onclick="unlinkUser('${dev.deviceId}')" style="font-size:0.75rem; color:#ef4444; border:none; background:none; cursor:pointer; text-decoration: underline;">Unlink User</button></div>` : ''}
            </td>
            <td style="text-align: right;">
                <button class="btn-small" style="background:#f59e0b; color:white;" onclick="openEditModal('${dev.deviceId}', ${channelCount})" title="Edit Channels"><i class="fa-solid fa-gear"></i></button>
                <button class="btn-small" style="background:#6366f1; color:white;" onclick="showPins(${channelCount})" title="View Pinout"><i class="fa-solid fa-microchip"></i></button>
                <button class="btn-small btn-qr" onclick="showQr('${dev.deviceId}', '${dev.secretCode}')" title="Get QR"><i class="fa-solid fa-qrcode"></i></button>
                <button class="btn-small btn-del" onclick="deleteDevice('${dev.deviceId}')" title="Delete"><i class="fa-solid fa-trash"></i></button>
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

    if(!deviceId) return alert("Device ID is required");

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
        if(res.ok) {
            closeCreateModal();
            loadData(); 
            showQr(deviceId, secretCode); 
        } else {
            alert(data.error);
        }
    } catch(err) { alert("Error creating device"); }
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
    } catch(err) { alert("Server Error"); }
}

// 7. UNLINK USER LOGIC
async function unlinkUser(id) {
    if(!confirm(`Remove user from ${id}? Device will be reset.`)) return;
    try {
        const res = await fetch(`${API_URL}/admin/unlink`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-access-token': token },
            body: JSON.stringify({ deviceId: id })
        });
        if(res.ok) loadData();
    } catch(err) { alert("Action failed"); }
}

// 8. DELETE DEVICE LOGIC
async function deleteDevice(id) {
    if(!confirm(`Permanently delete ${id}? This cannot be undone.`)) return;
    try {
        const res = await fetch(`${API_URL}/admin/device/${id}`, {
            method: 'DELETE',
            headers: { 'x-access-token': token }
        });
        if(res.ok) loadData();
    } catch(err) { alert("Delete failed"); }
}

// 9. DYNAMIC PINOUT DISPLAY
function showPins(count) {
    const tbody = document.getElementById('pin-table-body');
    tbody.innerHTML = '';
    
    // Only loop up to the specific device's channel count
    for(let i = 0; i < count; i++) {
        const pin = PIN_MAP[i];
        if(pin) {
            tbody.innerHTML += `
                <tr>
                    <td><b>${i+1}</b></td>
                    <td>GPIO ${pin.r}</td>
                    <td>GPIO ${pin.s} ${i===8 ? '<span style="color:#ef4444; font-size:0.7em;">(No Pullup)</span>' : ''}</td>
                </tr>`;
        }
    }
    document.getElementById('pin-modal').style.display = 'flex';
}

// 10. QR CODE LOGIC
function showQr(id, code) {
    const qrArea = document.getElementById('qr-print-area');
    const qrDiv = document.getElementById('qrcode');
    const qrText = document.getElementById('qr-text');

    qrDiv.innerHTML = ""; 
    qrText.innerHTML = `ID: ${id}<br>Code: ${code}`;
    
    const payload = JSON.stringify({ id: id, code: code });

    new QRCode(qrDiv, {
        text: payload,
        width: 150,
        height: 150
    });

    qrArea.style.display = 'block';
}

function closeQr() {
    document.getElementById('qr-print-area').style.display = 'none';
}

// 11. LOGOUT
function logout() {
    localStorage.removeItem('token');
    window.location.href = 'index.html';
}

// 12. OVERLAY AUTH HANDLER (Optional if button exists)
function adminLogin() {
    // This button is just a visual trigger in the HTML
    // The actual auth check happens at the top of this file (Section 2)
    // If we are here, we are already logged in or the token is missing
    if(token) {
        document.getElementById('auth-overlay').style.display = 'none';
        loadData();
    } else {
        window.location.href = 'index.html';
    }
}