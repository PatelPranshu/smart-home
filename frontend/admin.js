// ══════════════════════════════════════════
// ADMIN COMMAND CENTER — JavaScript
// ══════════════════════════════════════════

// SECURITY: XSS Prevention
function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Pin Map (Firmware GPIO)
const PIN_MAP = [
    { r: 22, s: 15 }, { r: 23, s: 16 }, { r: 14, s: 17 },
    { r: 27, s: 5 }, { r: 26, s: 18 }, { r: 25, s: 19 },
    { r: 33, s: 21 }, { r: 32, s: 34 }, { r: 4, s: 35 }
];

// ── Auth Check ──
const token = localStorage.getItem('token');
if (!token) {
    alert("Admin login required.");
    window.location.href = 'index.html';
} else {
    const overlay = document.getElementById('auth-overlay');
    if (overlay) overlay.style.display = 'none';
    loadData();
    // Auto-refresh every 10 seconds
    setInterval(loadData, 10000);
}

// ═══════════════════════════════════════════
// CORE DATA LOADING
// ═══════════════════════════════════════════

async function loadData() {
    try {
        const resStats = await fetch(`${API_URL}/admin/stats`, {
            headers: { 'x-access-token': token }
        });

        if (resStats.status === 403) {
            alert("Access Denied: Not an Admin account.");
            window.location.href = 'home.html';
            return;
        }

        const stats = await resStats.json();
        animateValue('val-devices', stats.totalDevices || 0);
        animateValue('val-users', stats.totalUsers || 0);
        animateValue('val-online', stats.onlineDevices || 0);
        animateValue('val-unsold', stats.unownedDevices || 0);

        const resDev = await fetch(`${API_URL}/admin/devices`, {
            headers: { 'x-access-token': token }
        });
        const devices = await resDev.json();
        renderTable(devices);

        loadFirmwareHistory();
        loadDeviceVersions();
    } catch (err) {
        console.error('[Dashboard]', err);
    }
}

// Animated number counter
function animateValue(elementId, target) {
    const el = document.getElementById(elementId);
    if (!el) return;
    const current = parseInt(el.innerText) || 0;
    if (current === target) return;
    el.innerText = target;
}

// ═══════════════════════════════════════════
// DEVICE INVENTORY TABLE
// ═══════════════════════════════════════════

function renderTable(devices) {
    const tbody = document.getElementById('device-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    devices.forEach(dev => {
        const tr = document.createElement('tr');

        const statusBadge = dev.isOnline
            ? `<span class="badge online"><span class="badge-dot"></span>Online</span>`
            : `<span class="badge offline"><span class="badge-dot"></span>Offline</span>`;

        const safeDeviceId = escapeHtml(dev.deviceId);
        const safeSecretCode = escapeHtml(dev.secretCode);
        const safeEmail = dev.owner ? escapeHtml(dev.owner.email) : null;
        const channelCount = dev.switches ? dev.switches.length : 9;

        const ownerCell = dev.owner
            ? `<span style="font-weight:600; color:var(--text-primary);">👤 ${safeEmail}</span>
               <div style="margin-top:3px;"><button onclick="unlinkUser('${safeDeviceId}')" style="font-size:0.7rem; color:var(--danger); border:none; background:none; cursor:pointer; text-decoration:underline;">Unlink</button></div>`
            : `<span style="color:var(--warning); font-weight:700; font-size:0.75rem; background:rgba(251,191,36,0.1); padding:3px 8px; border-radius:4px; border:1px solid rgba(251,191,36,0.2);">UNSOLD</span>`;

        tr.innerHTML = `
            <td>${statusBadge}</td>
            <td style="font-family:'JetBrains Mono','Courier New',monospace; font-weight:700; color:var(--cyan); font-size:0.82rem;">${safeDeviceId}</td>
            <td style="font-family:'JetBrains Mono','Courier New',monospace; letter-spacing:1px; color:var(--text-muted);">${safeSecretCode}</td>
            <td>${ownerCell}</td>
            <td style="text-align: right;">
                <button class="btn-small" style="color:var(--warning); border-color:rgba(251,191,36,0.2);" onclick="openEditModal('${safeDeviceId}', ${channelCount})" title="Edit"><i class="fa-solid fa-gear"></i></button>
                <button class="btn-small" style="color:var(--warning); border-color:rgba(251,191,36,0.2);" onclick='openInvertModal(${JSON.stringify(dev)})' title="Invert Logic"><i class="fa-solid fa-repeat"></i></button>
                <button class="btn-small" style="color:var(--cyan); border-color:rgba(34,211,238,0.2);" onclick="showPins(${channelCount})" title="Pinout"><i class="fa-solid fa-microchip"></i></button>
                <button class="btn-small btn-qr" onclick='showQr(${JSON.stringify(dev)})' title="QR Code"><i class="fa-solid fa-qrcode"></i></button>
                <button class="btn-small btn-del" onclick="deleteDevice('${safeDeviceId}')" title="Delete"><i class="fa-solid fa-trash"></i></button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// ═══════════════════════════════════════════
// DEVICE CRUD
// ═══════════════════════════════════════════

function openCreateModal() {
    document.getElementById('new-secret-code').value = Math.floor(100000 + Math.random() * 900000);
    document.getElementById('create-modal').style.display = 'flex';
}
function closeCreateModal() { document.getElementById('create-modal').style.display = 'none'; }

async function submitCreateDevice() {
    const deviceId = document.getElementById('new-device-id').value;
    const secretCode = document.getElementById('new-secret-code').value;
    const channels = document.getElementById('new-channels').value;
    if (!deviceId) return alert("Device ID is required");

    try {
        const res = await fetch(`${API_URL}/admin/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-access-token': token },
            body: JSON.stringify({ deviceId, secretCode, channels })
        });
        const data = await res.json();
        if (res.ok) {
            closeCreateModal();
            loadData();
            showQr({ deviceId, secretCode, switches: new Array(parseInt(channels)).fill({ inverted: false }) });
        } else { alert(data.error); }
    } catch (err) { alert("Error creating device"); }
}

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
        if (res.ok) { document.getElementById('edit-modal').style.display = 'none'; loadData(); }
        else { alert("Update Failed"); }
    } catch (err) { alert("Server Error"); }
}

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

async function deleteDevice(id) {
    if (!confirm(`Permanently delete ${id}?`)) return;
    try {
        const res = await fetch(`${API_URL}/admin/device/${id}`, {
            method: 'DELETE', headers: { 'x-access-token': token }
        });
        if (res.ok) loadData();
    } catch (err) { alert("Delete failed"); }
}

// ═══════════════════════════════════════════
// PINOUT & QR
// ═══════════════════════════════════════════

function showPins(count) {
    const tbody = document.getElementById('pin-table-body');
    tbody.innerHTML = '';
    for (let i = 0; i < count; i++) {
        const pin = PIN_MAP[i];
        if (pin) {
            tbody.innerHTML += `
                <tr>
                    <td><b>${i + 1}</b></td>
                    <td>GPIO ${pin.r}</td>
                    <td>GPIO ${pin.s} ${i === 8 ? '<span style="color:var(--danger); font-size:0.65em;">(No Pullup)</span>' : ''}</td>
                </tr>`;
        }
    }
    document.getElementById('pin-modal').style.display = 'flex';
}

function showQr(dev) {
    const qrArea = document.getElementById('qr-print-area');
    const qrDiv = document.getElementById('qrcode');
    const qrText = document.getElementById('qr-text');
    const hardwareTable = document.getElementById('qr-hardware-table');
    if (!qrArea || !qrDiv || !hardwareTable) return;

    qrDiv.innerHTML = "";
    qrText.innerHTML = `
        <div style="font-size: 1.3rem; font-weight: bold; margin-bottom: 5px;">Device: ${escapeHtml(dev.deviceId)}</div>
        <div style="font-size: 1rem; color: var(--text-secondary);">Code: ${escapeHtml(dev.secretCode)}</div>
    `;

    const payload = JSON.stringify({ id: dev.deviceId, code: dev.secretCode });
    new QRCode(qrDiv, { text: payload, width: 120, height: 120 });

    const channelCount = dev.switches?.length || 9;

    let htmlContent = `
        <div style="text-align: left; font-family: sans-serif; margin-top: 20px; color: var(--text-primary);">
            <div style="background: var(--bg-glass); padding: 8px; border-radius: 6px; margin-bottom: 15px; font-weight: 600; border: 1px solid var(--border);">
                Hardware: ${channelCount} Relays / ${channelCount} Switches
            </div>
            <div style="margin-bottom: 15px; color: var(--text-secondary);">
                <strong>Sensor:</strong> DHT11 (Temp & Humidity) on GPIO 13
            </div>

            <h4 style="font-size: 11px; margin-bottom: 5px; border-bottom: 1px solid var(--border); padding-bottom: 4px; color: var(--text-secondary);">Relay Connections</h4>
            <table style="width:100%; border-collapse: collapse; font-size: 10px; margin-bottom: 15px; color: var(--text-secondary);">
                <tr style="background:rgba(255,255,255,0.03);">
                    <th style="border: 1px solid var(--border); padding: 4px;">Channel</th>
                    <th style="border: 1px solid var(--border); padding: 4px;">GPIO</th>
                </tr>`;

    for (let i = 0; i < channelCount; i++) {
        htmlContent += `<tr>
            <td style="border: 1px solid var(--border); padding: 4px; font-weight:bold;">Relay ${i + 1}</td>
            <td style="border: 1px solid var(--border); padding: 4px;">GPIO ${PIN_MAP[i].r}</td>
        </tr>`;
    }

    htmlContent += `</table>

        <h4 style="font-size: 11px; margin-bottom: 5px; border-bottom: 1px solid var(--border); padding-bottom: 4px; color: var(--text-secondary);">Switch Connections</h4>
        <table style="width:100%; border-collapse: collapse; font-size: 10px; margin-bottom: 15px; color: var(--text-secondary);">
            <tr style="background:rgba(255,255,255,0.03);">
                <th style="border: 1px solid var(--border); padding: 4px;">Channel</th>
                <th style="border: 1px solid var(--border); padding: 4px;">GPIO</th>
            </tr>`;

    for (let i = 0; i < channelCount; i++) {
        htmlContent += `<tr>
            <td style="border: 1px solid var(--border); padding: 4px; font-weight:bold;">Switch ${i + 1}</td>
            <td style="border: 1px solid var(--border); padding: 4px;">GPIO ${PIN_MAP[i].s}</td>
        </tr>`;
    }

    htmlContent += `</table>
        <p style="font-size: 9px; font-style: italic; color: var(--text-muted);">* GPIO 34 & 35 need external 10K pull-up to 3.3V</p>
    </div>`;

    hardwareTable.innerHTML = htmlContent;
    qrArea.style.display = 'block';
}

function closeQr() { document.getElementById('qr-print-area').style.display = 'none'; }

// ═══════════════════════════════════════════
// LOGIC INVERSION
// ═══════════════════════════════════════════

function openInvertModal(device) {
    const tbody = document.getElementById('invert-table-body');
    tbody.innerHTML = '';
    device.switches.forEach(sw => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>
                <div style="font-weight:600; color:var(--text-primary);">${escapeHtml(sw.name)}</div>
                <div style="font-size:0.68rem; color:var(--text-muted);">ID: ${escapeHtml(String(sw.id))}</div>
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
            headers: { 'Content-Type': 'application/json', 'x-access-token': token },
            body: JSON.stringify({ deviceId, switchId, inverted: isInverted })
        });
        if (res.ok) loadData();
        else alert("Failed to update");
    } catch (err) { alert("Server Error"); }
}

// ═══════════════════════════════════════════
// LOGOUT
// ═══════════════════════════════════════════

function openLogoutModal() { const m = document.getElementById('logout-modal'); if (m) m.style.display = 'flex'; }
function closeLogoutModal() { const m = document.getElementById('logout-modal'); if (m) m.style.display = 'none'; }
function logoutThisDevice() { localStorage.removeItem('token'); window.location.href = 'index.html'; }

async function logoutAllDevices() {
    try {
        await fetch(`${API_URL}/logout-all`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-access-token': token }
        });
    } catch (err) { console.error("Logout all failed"); }
    finally { logoutThisDevice(); }
}

function adminLogin() {
    if (token) {
        document.getElementById('auth-overlay').style.display = 'none';
        loadData();
    } else { window.location.href = 'index.html'; }
}

// ═══════════════════════════════════════════
// OTA FIRMWARE MANAGEMENT
// ═══════════════════════════════════════════

let _allDevicesCache = [];

function formatDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
        + ' ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

// ── FIRMWARE HISTORY TABLE ──
async function loadFirmwareHistory() {
    try {
        const res = await fetch(`${API_URL}/admin/firmware`, {
            headers: { 'x-access-token': token }
        });
        if (!res.ok) return;
        const releases = await res.json();
        renderFirmwareTable(releases);
    } catch (err) { console.error('[OTA] Load error', err); }
}

function renderFirmwareTable(releases) {
    const tbody = document.getElementById('firmware-table-body');
    if (!tbody) return;

    if (!releases.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:30px;">No firmware releases yet</td></tr>';
        return;
    }

    tbody.innerHTML = '';
    releases.forEach(fw => {
        const tr = document.createElement('tr');
        const targetLabel = fw.targetType === 'all'
            ? '<span style="color:var(--text-secondary);">All Devices</span>'
            : `<span style="color:var(--text-secondary);">${fw.targetDevices.length} device(s)</span>`;

        const canRollback = (fw.status === 'active' || fw.status === 'rolled_back') && fw.localFilename;
        const canCancel = fw.status === 'scheduled';

        let actions = '—';
        if (canCancel) {
            actions = `
                <button class="btn-cancel-fw" onclick="cancelScheduledUpdate('${fw._id}', '${escapeHtml(fw.version)}')" title="Cancel this update">
                    <i class="fa-solid fa-ban"></i> Stop
                </button>`;
        } else if (canRollback) {
            actions = `
                <button class="btn-rollback" onclick="openRollbackModal('${fw._id}', '${escapeHtml(fw.version)}')" title="Rollback">
                    <i class="fa-solid fa-rotate-left"></i> Rollback
                </button>`;
        }

        tr.innerHTML = `
            <td><span class="fw-version">v${escapeHtml(fw.version)}</span></td>
            <td><span class="fw-badge ${escapeHtml(fw.status)}">${escapeHtml(fw.status.replace('_', ' '))}</span></td>
            <td style="font-size:0.8rem; color:var(--text-muted);">${formatDate(fw.scheduledAt)}</td>
            <td style="font-size:0.8rem; color:var(--text-muted);">${formatDate(fw.releasedAt)}</td>
            <td style="font-size:0.8rem;">${targetLabel}</td>
            <td style="text-align: right;">${actions}</td>
        `;
        tbody.appendChild(tr);
    });
}

// ── CANCEL SCHEDULED UPDATE ──
async function cancelScheduledUpdate(firmwareId, version) {
    if (!confirm(`Stop scheduled update v${version}?`)) return;
    try {
        const res = await fetch(`${API_URL}/admin/firmware/cancel`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-access-token': token },
            body: JSON.stringify({ firmwareId })
        });
        const data = await res.json();
        if (res.ok) {
            loadFirmwareHistory();
            loadDeviceVersions();
            alert(`Update v${version} cancelled.`);
        } else {
            alert(data.error || 'Cancel failed');
        }
    } catch (err) { alert('Server Error'); }
}

// ── DEVICE VERSION TRACKING (Card Grid) ──
async function loadDeviceVersions() {
    try {
        const res = await fetch(`${API_URL}/admin/device-versions`, {
            headers: { 'x-access-token': token }
        });
        if (!res.ok) return;
        const devices = await res.json();
        _allDevicesCache = devices;
        renderVersionCards(devices);
    } catch (err) { console.error('[OTA] Version load error', err); }
}

function renderVersionCards(devices) {
    const container = document.getElementById('version-grid-container');
    const countLabel = document.getElementById('version-count-label');
    if (!container) return;

    if (countLabel) {
        const online = devices.filter(d => d.isOnline).length;
        countLabel.textContent = `${devices.length} devices • ${online} online`;
    }

    if (!devices.length) {
        container.innerHTML = '<div style="grid-column:1/-1; text-align:center; color:var(--text-muted); padding:30px;">No devices registered</div>';
        return;
    }

    container.innerHTML = '';
    devices.forEach(dev => {
        const isOnline = dev.isOnline;
        const card = document.createElement('div');
        card.className = 'version-card';

        const pending = dev.pendingUpdate
            ? `<span class="fw-badge scheduled" style="font-size:0.62rem;">v${escapeHtml(dev.pendingUpdate.version)} queued</span>`
            : '';

        card.innerHTML = `
            <div class="version-card-icon ${isOnline ? 'online' : 'offline'}">
                <i class="fa-solid ${isOnline ? 'fa-wifi' : 'fa-power-off'}"></i>
            </div>
            <div class="version-card-info">
                <div class="version-card-id">${escapeHtml(dev.deviceId)}</div>
                <div class="version-card-meta">
                    <span class="fw-version" style="font-size:0.78rem;">v${escapeHtml(dev.firmwareVersion || '?.?.?')}</span>
                    ${pending}
                    <span class="badge ${isOnline ? 'online' : 'offline'}" style="font-size:0.62rem; padding:2px 7px;">
                        <span class="badge-dot" style="width:4px;height:4px;margin-right:4px;"></span>${isOnline ? 'ON' : 'OFF'}
                    </span>
                </div>
            </div>
        `;
        container.appendChild(card);
    });
}

// ═══════════════════════════════════════════
// SCHEDULE UPDATE MODAL
// ═══════════════════════════════════════════

function toLocalISOString(date) {
    const off = date.getTimezoneOffset();
    const local = new Date(date.getTime() - off * 60000);
    return local.toISOString().slice(0, 16);
}

function openScheduleModal() {
    const now = new Date();
    const minDate = new Date(now.getTime() + 60 * 1000); // Now + 1 minute
    const dateInput = document.getElementById('ota-schedule-date');
    dateInput.value = toLocalISOString(minDate);
    dateInput.min = toLocalISOString(now); // Can't go earlier than now
    document.getElementById('ota-version').value = '';
    document.getElementById('ota-github-url').value = '';
    populateDeviceChecklist('ota-device-checklist', _allDevicesCache);
    document.getElementById('schedule-modal').style.display = 'flex';
}

function closeScheduleModal() { document.getElementById('schedule-modal').style.display = 'none'; }

function toggleOtaDeviceList() {
    const val = document.querySelector('input[name="ota-target"]:checked').value;
    document.getElementById('ota-device-select-container').style.display = val === 'specific' ? 'block' : 'none';
}

async function submitScheduleUpdate() {
    const version = document.getElementById('ota-version').value.trim();
    const githubUrl = document.getElementById('ota-github-url').value.trim();
    const scheduledAt = document.getElementById('ota-schedule-date').value;
    const targetType = document.querySelector('input[name="ota-target"]:checked').value;

    if (!version || !githubUrl || !scheduledAt) return alert('Please fill all required fields');

    // Block scheduling in the past
    if (new Date(scheduledAt) <= new Date()) {
        return alert('Release time must be in the future');
    }

    let targetDevices = [];
    if (targetType === 'specific') {
        targetDevices = getCheckedDevices('ota-device-checklist');
        if (!targetDevices.length) return alert('Select at least one device');
    }

    try {
        const res = await fetch(`${API_URL}/admin/firmware`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-access-token': token },
            body: JSON.stringify({
                version, githubUrl,
                scheduledAt: new Date(scheduledAt).toISOString(),
                targetType, targetDevices
            })
        });
        const data = await res.json();
        if (res.ok) {
            closeScheduleModal();
            loadFirmwareHistory();
            alert(`Firmware v${version} scheduled!`);
        } else { alert(data.error || 'Failed'); }
    } catch (err) { alert('Server Error'); }
}

// ═══════════════════════════════════════════
// ROLLBACK MODAL
// ═══════════════════════════════════════════

function openRollbackModal(firmwareId, version) {
    document.getElementById('rollback-firmware-id').value = firmwareId;
    document.getElementById('rollback-version-label').textContent = 'v' + version;
    populateDeviceChecklist('rollback-device-checklist', _allDevicesCache);
    document.getElementById('rollback-modal').style.display = 'flex';
}

function toggleRollbackDeviceList() {
    const val = document.querySelector('input[name="rollback-target"]:checked').value;
    document.getElementById('rollback-device-select-container').style.display = val === 'specific' ? 'block' : 'none';
}

async function submitRollback() {
    const firmwareId = document.getElementById('rollback-firmware-id').value;
    const targetType = document.querySelector('input[name="rollback-target"]:checked').value;

    let targetDevices = [];
    if (targetType === 'specific') {
        targetDevices = getCheckedDevices('rollback-device-checklist');
        if (!targetDevices.length) return alert('Select at least one device');
    }

    if (!confirm('Execute firmware rollback?')) return;

    try {
        const res = await fetch(`${API_URL}/admin/firmware/rollback`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-access-token': token },
            body: JSON.stringify({ firmwareId, targetType, targetDevices })
        });
        const data = await res.json();
        if (res.ok) {
            document.getElementById('rollback-modal').style.display = 'none';
            loadFirmwareHistory();
            loadDeviceVersions();
            alert(`Rollback to ${data.version} initiated!`);
        } else { alert(data.error || 'Rollback failed'); }
    } catch (err) { alert('Server Error'); }
}

// ═══════════════════════════════════════════
// DEVICE CHECKLIST HELPERS
// ═══════════════════════════════════════════

function populateDeviceChecklist(containerId, devices) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!devices.length) {
        container.innerHTML = '<div style="padding:12px; color:var(--text-muted); text-align:center;">No devices found</div>';
        return;
    }

    container.innerHTML = devices.map(dev => `
        <label class="ota-device-item">
            <input type="checkbox" value="${escapeHtml(dev.deviceId)}">
            <span style="font-family:'JetBrains Mono','Courier New',monospace; font-weight:700; font-size:0.8rem; color:var(--text-primary);">${escapeHtml(dev.deviceId)}</span>
            ${dev.isOnline
            ? '<span class="badge online" style="margin-left:auto; font-size:0.62rem; padding:2px 7px;"><span class="badge-dot" style="width:4px;height:4px;margin-right:3px;"></span>ON</span>'
            : '<span class="badge offline" style="margin-left:auto; font-size:0.62rem; padding:2px 7px;"><span class="badge-dot" style="width:4px;height:4px;margin-right:3px;"></span>OFF</span>'
        }
        </label>
    `).join('');
}

function getCheckedDevices(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return [];
    return Array.from(container.querySelectorAll('input[type="checkbox"]:checked'))
        .map(cb => cb.value);
}