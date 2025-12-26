// const API_URL = 'http://localhost:3000/api';
const API_URL = 'https://smart-home-04m4.onrender.com/api'

// 1. Get Token from LocalStorage (Saved when you logged in on index.html)
const token = localStorage.getItem('token');

// 2. CHECK AUTH ON LOAD
if (!token) {
    alert("You must log in as an Admin first.");
    window.location.href = 'index.html'; // Redirect to main login
} else {
    // Hide the old auth overlay if it exists in HTML
    const overlay = document.getElementById('auth-overlay');
    if(overlay) overlay.style.display = 'none';
    
    // Load Data immediately
    loadData();
}

async function loadData() {
    try {
        // Fetch Stats
        const resStats = await fetch(`${API_URL}/admin/stats`, {
            headers: { 'x-access-token': token } 
        });
        
        // Handle "Not Admin" error
        if(resStats.status === 403) {
            alert("Access Denied: Your account is not an Admin.");
            window.location.href = 'home.html';
            return;
        }

        const stats = await resStats.json();
        document.getElementById('val-devices').innerText = stats.totalDevices;
        document.getElementById('val-users').innerText = stats.totalUsers;
        document.getElementById('val-online').innerText = stats.onlineDevices;
        document.getElementById('val-unsold').innerText = stats.unownedDevices;

        // Fetch Devices
        const resDev = await fetch(`${API_URL}/admin/devices`, {
            headers: { 'x-access-token': token }
        });
        const devices = await resDev.json();
        renderTable(devices);

    } catch(err) {
        console.error(err);
        alert("Connection Error");
    }
}

// --- 3. RENDER TABLE ---
function renderTable(devices) {
    const tbody = document.getElementById('device-table-body');
    tbody.innerHTML = '';

    devices.forEach(dev => {
        const tr = document.createElement('tr');
        
        const ownerDisplay = dev.owner ? `👤 ${dev.owner.email}` : `<span style="color:#f59e0b; font-weight:bold;">Unsold</span>`;
        const onlineClass = dev.isOnline ? 'online' : '';
        
        tr.innerHTML = `
            <td><span class="status-dot ${onlineClass}"></span> ${dev.isOnline ? 'Online' : 'Offline'}</td>
            <td style="font-family:monospace; font-weight:bold;">${dev.deviceId}</td>
            <td style="font-family:monospace;">${dev.secretCode}</td>
            <td>${ownerDisplay}</td>
            <td>
                <button class="btn-small btn-qr" onclick="showQr('${dev.deviceId}', '${dev.secretCode}')"><i class="fa-solid fa-qrcode"></i> Sticker</button>
                <button class="btn-small btn-del" onclick="deleteDevice('${dev.deviceId}')"><i class="fa-solid fa-trash"></i></button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// --- 4. CREATE DEVICE ---
function openCreateModal() {
    // Auto-generate a random code for convenience
    document.getElementById('new-secret-code').value = Math.floor(100000 + Math.random() * 900000);
    document.getElementById('create-modal').style.display = 'flex';
}

function closeCreateModal() {
    document.getElementById('create-modal').style.display = 'none';
}

async function submitCreateDevice() {
    const deviceId = document.getElementById('new-device-id').value;
    const secretCode = document.getElementById('new-secret-code').value;

    if(!deviceId) return alert("Device ID is required (Check Serial Monitor)");

    try {
        const res = await fetch(`${API_URL}/admin/create`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'x-access-token': token  // <--- FIXED: Uses token now
            },
            body: JSON.stringify({ deviceId, secretCode })
        });
        
        const data = await res.json();
        if(res.ok) {
            closeCreateModal();
            loadData(); // Refresh table
            showQr(deviceId, secretCode); // Auto show QR for printing
        } else {
            alert(data.error);
        }
    } catch(err) { alert("Error creating device"); }
}

// --- 5. DELETE DEVICE ---
async function deleteDevice(id) {
    if(!confirm(`Permanently delete ${id}? This cannot be undone.`)) return;

    try {
        const res = await fetch(`${API_URL}/admin/device/${id}`, {
            method: 'DELETE',
            headers: { 'x-access-token': token } // <--- FIXED: Uses token now
        });
        if(res.ok) loadData();
    } catch(err) { alert("Delete failed"); }
}

// --- 6. QR CODE LOGIC ---
function showQr(id, code) {
    const qrArea = document.getElementById('qr-print-area');
    const qrDiv = document.getElementById('qrcode');
    const qrText = document.getElementById('qr-text');

    qrDiv.innerHTML = ""; // Clear old
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

// REMOVED: "if(ADMIN_KEY) loadData();" line because loadData() is already called at the top.