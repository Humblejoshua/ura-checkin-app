(() => {
  'use strict';

  const DB_KEY = 'ura_onboarding_db';
  let mode = '';          // 'attendance' or 'meals'
  let mealType = '';      // 'breakfast' or 'lunch'
  let setup = {};
  let learners = [];
  let auditLog = [];
  let navHistory = [];    // stack of previous screens
  let currentScreen = 'mode';

  function init() {
    loadDB();
    updateOnlineStatus();
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    if (setup.session) showApp();
  }

  // ── Storage ──
  function loadDB() {
    try {
      const raw = localStorage.getItem(DB_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        mode = d.mode || '';
        mealType = d.mealType || '';
        setup = d.setup || {};
        learners = d.learners || [];
        auditLog = d.auditLog || [];
      }
    } catch (e) { /* fresh start */ }
  }

  function saveDB() {
    localStorage.setItem(DB_KEY, JSON.stringify({ mode, mealType, setup, learners, auditLog }));
  }

  // ── Navigation ──
  function navigateTo(screenId) {
    navHistory.push(currentScreen);
    currentScreen = screenId;
    showScreen(screenId);
    updateBackBtn();
  }

  function goBack() {
    if (navHistory.length === 0) return;
    const prev = navHistory.pop();
    currentScreen = prev;
    showScreen(prev);
    updateBackBtn();
  }
  window.goBack = goBack;

  function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));

    if (screenId === 'mode') {
      document.getElementById('modeScreen').classList.add('active');
      document.getElementById('tabBar').style.display = 'none';
    } else if (screenId === 'setup') {
      document.getElementById('setupScreen').classList.add('active');
      document.getElementById('tabBar').style.display = 'none';
    } else if (screenId === 'main') {
      const mainScreen = mode === 'attendance' ? 'attScreen' : 'mealScreen';
      document.getElementById(mainScreen).classList.add('active');
      document.getElementById('tabBar').style.display = 'flex';
      document.querySelector('.tab[data-tab="main"]').classList.add('active');
      if (mode === 'attendance') renderAtt(); else renderMeal();
    } else if (screenId === 'search') {
      document.getElementById('searchScreen').classList.add('active');
      document.getElementById('tabBar').style.display = 'flex';
      document.querySelector('.tab[data-tab="search"]').classList.add('active');
    } else if (screenId === 'export') {
      document.getElementById('exportScreen').classList.add('active');
      document.getElementById('tabBar').style.display = 'flex';
      document.querySelector('.tab[data-tab="export"]').classList.add('active');
      updateDataStats();
    }
  }

  function updateBackBtn() {
    const btn = document.getElementById('backBtn');
    if (navHistory.length > 0 && currentScreen !== 'mode') {
      btn.style.display = 'flex';
    } else {
      btn.style.display = 'none';
    }
  }

  // ── Mode Selection ──
  window.chooseMode = function (m) {
    mode = m;
    if (m === 'attendance') {
      document.getElementById('setupTitle').textContent = 'Attendance Setup';
      document.getElementById('setupDesc').textContent = 'This device will record time-in only.';
      document.getElementById('setupMealTypeGroup').style.display = 'none';
    } else {
      document.getElementById('setupTitle').textContent = 'Meals Setup';
      document.getElementById('setupDesc').textContent = 'This device will clear meals only.';
      document.getElementById('setupMealTypeGroup').style.display = 'block';
    }
    navigateTo('setup');
  };

  window.goBackToMode = function () {
    navHistory = [];
    currentScreen = 'mode';
    showScreen('mode');
    updateBackBtn();
  };

  window.saveSetup = function () {
    const date = document.getElementById('setupDate').value;
    const session = document.getElementById('setupSession').value.trim();
    const supervisor = document.getElementById('setupSupervisor').value.trim();
    const device = document.getElementById('setupDevice').value.trim();

    if (!date || !session || !supervisor || !device) {
      showToast('Fill in all fields', 'error');
      return;
    }

    if (mode === 'meals') {
      mealType = document.getElementById('setupMealType').value;
    }

    setup = { date, session, supervisor, device };
    saveDB();
    showApp();
  };

  function showApp() {
    navHistory = [];
    const dateStr = formatDate(setup.date);
    if (mode === 'attendance') {
      document.getElementById('headerSubtitle').textContent = `Attendance — ${setup.session} — ${dateStr}`;
      document.getElementById('tabMainLabel').textContent = 'Check-In';
      renderAtt();
    } else {
      const mealLabel = mealType.charAt(0).toUpperCase() + mealType.slice(1);
      document.getElementById('headerSubtitle').textContent = `${mealLabel} — ${setup.session} — ${dateStr}`;
      document.getElementById('tabMainLabel').textContent = mealLabel;
      document.getElementById('mealTitle').textContent = `${mealLabel} Clearance`;
      document.getElementById('mealColHeader').textContent = mealLabel;
      document.getElementById('qrSection').style.display = 'block';
      renderMeal();
    }
    currentScreen = 'main';
    showScreen('main');
    updateExportDesc();
  }

  // ── Tabs ──
  window.switchTab = function (tab) {
    if (tab === 'main') {
      navHistory = [];
      currentScreen = 'main';
      showScreen('main');
      updateBackBtn();
    } else {
      navigateTo(tab);
    }
  };

  // ── Online Status ──
  function updateOnlineStatus() {
    const dot = document.getElementById('statusDot');
    dot.classList.toggle('offline', !navigator.onLine);
    dot.title = navigator.onLine ? 'Online' : 'Offline — data saved locally';
  }

  // ── ATTENDANCE RENDER ──
  function renderAtt() {
    const tbody = document.getElementById('attBody');
    const empty = document.getElementById('attEmpty');
    const tableContainer = document.querySelector('#attScreen .table-container');

    if (!learners.length) {
      empty.style.display = 'block';
      tableContainer.style.display = 'none';
      return;
    }
    empty.style.display = 'none';
    tableContainer.style.display = 'block';

    tbody.innerHTML = learners.map((l, i) => `
      <tr class="${l.timeIn ? 'checked-in' : ''}">
        <td>${l.sn}</td>
        <td>${l.indexNumber}</td>
        <td>${l.name}</td>
        <td>${l.staffId}</td>
        <td>${l.timeIn || '—'}</td>
        <td><button class="btn-checkin ${l.timeIn ? 'done' : ''}" onclick="doCheckIn(${i})">
          ${l.timeIn ? '&#10003; Done' : 'Time In'}
        </button></td>
      </tr>
    `).join('');

    document.getElementById('attCheckedIn').textContent = learners.filter(l => l.timeIn).length;
    document.getElementById('attTotal').textContent = learners.length;
  }

  window.doCheckIn = function (idx) {
    const l = learners[idx];
    if (l.timeIn) { showToast('Already checked in', 'warning'); return; }
    const now = new Date();
    l.timeIn = now.toTimeString().slice(0, 5);
    l.device = setup.device;
    l.timestamp = now.toISOString();
    audit('CHECK-IN', l.staffId, l.name, 'Time In: ' + l.timeIn);
    saveDB();
    renderAtt();
    showToast(`${l.name} checked in at ${l.timeIn}`, 'success');
  };

  // ── MEAL RENDER ──
  function renderMeal() {
    const tbody = document.getElementById('mealBody');
    const empty = document.getElementById('mealEmpty');
    const tableContainer = document.querySelector('#mealScreen .table-container');

    if (!learners.length) {
      empty.style.display = 'block';
      tableContainer.style.display = 'none';
      return;
    }
    empty.style.display = 'none';
    tableContainer.style.display = 'block';

    const key = mealType; // 'breakfast' or 'lunch'

    tbody.innerHTML = learners.map((l, i) => {
      const done = !!l[key];
      return `
        <tr class="${done ? 'has-meal' : ''}">
          <td>${l.sn}</td>
          <td>${l.name}</td>
          <td>${l.staffId}</td>
          <td>${done ? '&#10003; Cleared' : 'Pending'}</td>
          <td><button class="btn-checkin ${done ? 'done' : ''}" onclick="doMeal(${i})">
            ${done ? '&#10003; Done' : 'Clear'}
          </button></td>
        </tr>
      `;
    }).join('');

    document.getElementById('mealCleared').textContent = learners.filter(l => l[key]).length;
    document.getElementById('mealTotal').textContent = learners.length;
  }

  window.doMeal = function (idx) {
    const l = learners[idx];
    const key = mealType;
    if (l[key]) {
      showToast(`${mealType} already cleared for ${l.name}`, 'warning');
      return;
    }
    const now = new Date();
    l[key] = now.toTimeString().slice(0, 5);
    l.device = setup.device;
    l.timestamp = now.toISOString();
    audit('MEAL-CLEAR', l.staffId, l.name, mealType + ': ' + l[key]);
    saveDB();
    renderMeal();
    showToast(`${mealType} cleared for ${l.name}`, 'success');
  };

  // ── CSV IMPORT ──
  window.importCSV = function (event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
      const lines = parseCSV(e.target.result);
      if (lines.length < 2) { showToast('CSV is empty', 'error'); return; }

      const header = lines[0].map(h => h.trim().toLowerCase());
      const snIdx = header.findIndex(h => h.includes('s/n') || h.includes('sn'));
      const idxIdx = header.findIndex(h => h.includes('index'));
      const nameIdx = header.findIndex(h => h.includes('name') || h.includes('candidate'));
      const staffIdx = header.findIndex(h => h.includes('staff'));

      if (nameIdx === -1 || staffIdx === -1) {
        showToast('CSV needs Name and Staff ID columns', 'error');
        return;
      }

      learners = [];
      for (let i = 1; i < lines.length; i++) {
        const row = lines[i];
        if (row.length < 2 || !row[nameIdx]?.trim()) continue;
        learners.push({
          sn: snIdx >= 0 ? row[snIdx] : i,
          indexNumber: idxIdx >= 0 ? row[idxIdx] : '',
          name: row[nameIdx]?.trim() || '',
          staffId: row[staffIdx]?.trim() || '',
          timeIn: '',
          breakfast: '',
          lunch: '',
          device: '',
          timestamp: ''
        });
      }

      saveDB();
      audit('IMPORT', 'SYSTEM', 'System', `Imported ${learners.length} learners`);
      document.getElementById('importStatus').textContent = `${learners.length} learners loaded.`;
      showToast(`${learners.length} learners imported`, 'success');
    };
    reader.readAsText(file);
  };

  function parseCSV(text) {
    const lines = []; let current = []; let inQ = false; let field = '';
    for (let i = 0; i < text.length; i++) {
      const ch = text[i], next = text[i + 1];
      if (inQ) {
        if (ch === '"' && next === '"') { field += '"'; i++; }
        else if (ch === '"') inQ = false;
        else field += ch;
      } else {
        if (ch === '"') inQ = true;
        else if (ch === ',') { current.push(field.trim()); field = ''; }
        else if (ch === '\n' || (ch === '\r' && next === '\n')) {
          current.push(field.trim());
          if (current.some(f => f)) lines.push(current);
          current = []; field = '';
          if (ch === '\r') i++;
        } else if (ch === '\r') {
          current.push(field.trim());
          if (current.some(f => f)) lines.push(current);
          current = []; field = '';
        } else field += ch;
      }
    }
    if (field || current.length) { current.push(field.trim()); if (current.some(f => f)) lines.push(current); }
    return lines;
  }

  // ── SEARCH ──
  window.filterAtt = function () {
    const q = document.getElementById('attSearch').value.toLowerCase();
    document.querySelectorAll('#attBody tr').forEach((row, i) => {
      const l = learners[i];
      row.style.display = (!l || l.name.toLowerCase().includes(q) || l.staffId.includes(q) || l.indexNumber.toLowerCase().includes(q)) ? '' : 'none';
    });
  };

  window.filterMeal = function () {
    const q = document.getElementById('mealSearch').value.toLowerCase();
    document.querySelectorAll('#mealBody tr').forEach((row, i) => {
      const l = learners[i];
      row.style.display = (!l || l.name.toLowerCase().includes(q) || l.staffId.includes(q)) ? '' : 'none';
    });
  };

  window.globalSearchFn = function () {
    const q = document.getElementById('globalSearch').value.toLowerCase().trim();
    const c = document.getElementById('searchResults');
    if (!q) { c.innerHTML = '<p class="microcopy">Type to search...</p>'; return; }
    const hits = learners.filter(l => l.name.toLowerCase().includes(q) || l.staffId.includes(q) || l.indexNumber.toLowerCase().includes(q));
    if (!hits.length) { c.innerHTML = '<p class="microcopy">No results.</p>'; return; }
    c.innerHTML = hits.slice(0, 20).map(l => `
      <div class="search-result-card">
        <h4>${l.name}</h4>
        <p>Staff ID: ${l.staffId} | Index: ${l.indexNumber}</p>
        <p>
          <span class="status-badge ${l.timeIn ? 'badge-done' : 'badge-pending'}">Time In: ${l.timeIn || 'Pending'}</span>
          <span class="status-badge ${l.breakfast ? 'badge-done' : 'badge-pending'}">Breakfast: ${l.breakfast || 'Pending'}</span>
          <span class="status-badge ${l.lunch ? 'badge-done' : 'badge-pending'}">Lunch: ${l.lunch || 'Pending'}</span>
        </p>
      </div>
    `).join('');
  };

  // ── QR CODE ──
  window.startQRScan = function (scanMode) {
    document.getElementById('qrModal').style.display = 'flex';
    document.getElementById('qrResult').innerHTML = '';
    document.getElementById('qrReader').innerHTML = `
      <div style="padding:20px;text-align:center;">
        <input type="text" id="manualQR" placeholder="Type Staff ID"
          style="font-size:16px;padding:12px;width:100%;"
          onkeypress="if(event.key==='Enter')processQR(this.value)">
        <button class="btn-primary" style="margin-top:8px;"
          onclick="processQR(document.getElementById('manualQR').value)">Submit</button>
        <p class="microcopy" style="margin-top:8px;">Or point camera at QR badge</p>
        <div id="qrCamArea"></div>
      </div>
    `;
    tryStartCamera(scanMode);
  };

  function tryStartCamera(scanMode) {
    if (typeof Html5Qrcode === 'undefined') return;
    const area = document.getElementById('qrCamArea');
    area.innerHTML = '<div id="qrCamTarget" style="width:100%;height:250px;"></div>';
    const cam = new Html5Qrcode('qrCamTarget');
    cam.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 250, height: 250 } },
      (text) => { processQR(text); cam.stop(); },
      () => {}
    ).catch(() => {});
  }

  window.processQR = function (staffId) {
    staffId = staffId.trim();
    if (!staffId) return;
    const l = learners.find(x => x.staffId === staffId);
    if (!l) {
      document.getElementById('qrResult').innerHTML =
        `<div style="background:#FFF3CD;padding:10px;border-radius:8px;">Staff ID ${staffId} not found</div>`;
      return;
    }
    const idx = learners.indexOf(l);
    if (mode === 'attendance') {
      doCheckIn(idx);
      document.getElementById('qrResult').innerHTML =
        `<div style="background:#D4EDDA;padding:10px;border-radius:8px;">&#10003; ${l.name} checked in at ${l.timeIn}</div>`;
    } else {
      doMeal(idx);
      document.getElementById('qrResult').innerHTML =
        `<div style="background:#D4EDDA;padding:10px;border-radius:8px;">&#10003; ${mealType} cleared for ${l.name}</div>`;
    }
  };

  window.closeQR = function () {
    document.getElementById('qrModal').style.display = 'none';
    document.getElementById('qrReader').innerHTML = '';
  };

  // ── EXPORT ──
  function updateExportDesc() {
    const el = document.getElementById('exportFormatDesc');
    if (mode === 'attendance') {
      el.textContent = 'CSV columns: S/N, Index Number, Candidate Name, Staff ID, Time In, Morning, Midmorning, Afternoon';
    } else {
      el.textContent = `CSV columns: S/N, Candidate Name, Staff ID, ${mealType.charAt(0).toUpperCase() + mealType.slice(1)}`;
    }
  }

  window.toggleExportBtns = function () {
    const ok = document.getElementById('supervisorApproval').checked;
    document.getElementById('exportBtn').disabled = !ok;
    document.getElementById('exportPdfBtn').disabled = !ok;
  };

  window.exportCSV = function () {
    const sig = document.getElementById('supervisorSignature').value.trim();
    if (!sig) { showToast('Enter supervisor name', 'error'); return; }

    audit('EXPORT-CSV', 'SUPERVISOR', sig, 'CSV exported');
    saveDB();

    const dateStr = formatDate(setup.date);
    const session = setup.session;

    let csv;
    if (mode === 'attendance') {
      const title = `Tax Academy On-Boarding 2026 (${session})`;
      csv = `S/N,Index Number,Candidate Name,Staff ID,Time In,Morning,Midmorning,Afternoon\n`;
      learners.forEach(l => {
        csv += `${l.sn},"${l.indexNumber}","${l.name}","${l.staffId}","${l.timeIn || ''}","","",""\n`;
      });
      const header = `${title}\nDate: ${dateStr}\nSupervisor: ${sig}\n\n`;
      downloadFile(header + csv, `URA_Attendance_${setup.date}_${session.replace(/\s+/g, '_')}.csv`, 'text/csv');
    } else {
      const mealLabel = mealType.charAt(0).toUpperCase() + mealType.slice(1);
      const title = `Tax Academy On-Boarding 2026 (${session})`;
      csv = `S/N,Candidate Name,Staff ID,${mealLabel}\n`;
      learners.forEach(l => {
        csv += `${l.sn},"${l.name}","${l.staffId}","${l[mealType] || ''}"\n`;
      });
      const header = `${title}\nDate: ${dateStr}\nSupervisor: ${sig}\n\n`;
      downloadFile(header + csv, `URA_${mealLabel}_${setup.date}_${session.replace(/\s+/g, '_')}.csv`, 'text/csv');
    }

    showToast('CSV downloaded', 'success');
  };

  window.exportPDF = function () {
    const sig = document.getElementById('supervisorSignature').value.trim();
    if (!sig) { showToast('Enter supervisor name', 'error'); return; }

    audit('EXPORT-PDF', 'SUPERVISOR', sig, 'PDF exported');
    saveDB();

    const dateStr = formatDate(setup.date);
    let tableHTML;

    if (mode === 'attendance') {
      tableHTML = `<table><thead><tr>
        <th>S/N</th><th>Index Number</th><th>Candidate Name</th><th>Staff ID</th>
        <th>Time In</th><th>Morning</th><th>Midmorning</th><th>Afternoon</th>
      </tr></thead><tbody>${learners.map(l => `<tr>
        <td>${l.sn}</td><td>${l.indexNumber}</td><td>${l.name}</td><td>${l.staffId}</td>
        <td>${l.timeIn || ''}</td><td></td><td></td><td></td>
      </tr>`).join('')}</tbody></table>`;
    } else {
      const mealLabel = mealType.charAt(0).toUpperCase() + mealType.slice(1);
      tableHTML = `<table><thead><tr>
        <th>S/N</th><th>Candidate Name</th><th>Staff ID</th><th>${mealLabel}</th>
      </tr></thead><tbody>${learners.map(l => `<tr>
        <td>${l.sn}</td><td>${l.name}</td><td>${l.staffId}</td><td>${l[mealType] || ''}</td>
      </tr>`).join('')}</tbody></table>`;
    }

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
      <title>URA Report</title>
      <style>
        body{font-family:Arial,sans-serif;margin:20px;color:#1A1A2E}
        .header{text-align:center;margin-bottom:20px}
        .header h1{color:#0265B1;font-size:18px;margin-bottom:4px}
        .header p{font-size:13px;color:#666;margin-bottom:2px}
        table{width:100%;border-collapse:collapse;font-size:12px;margin-top:10px}
        th{background:#0265B1;color:white;padding:8px 6px;text-align:left;border:1px solid #0265B1}
        td{padding:6px;border:1px solid #ddd}
        tr:nth-child(even){background:#F8F9FA}
        .footer{margin-top:30px;font-size:11px;color:#666}
        .sig-line{border-bottom:1px solid #000;width:200px;display:inline-block;margin:0 10px}
      </style></head><body>
      <div class="header">
        <h1>Tax Academy On-Boarding 2026 (${setup.session})</h1>
        <p>Date: ${dateStr}</p>
      </div>
      ${tableHTML}
      <div class="footer">
        <p>Supervisor: <span class="sig-line"></span> ${sig}</p>
        <p>Date: ${dateStr} &nbsp; Signature: <span class="sig-line"></span></p>
      </div>
    </body></html>`;

    const w = window.open('', '_blank');
    w.document.write(html);
    w.document.close();
    w.print();
    showToast('Use browser Print > Save as PDF', 'success');
  };

  // ── QR BADGES ──
  window.generateQrBadges = function () {
    if (!learners.length) { showToast('Import learners first', 'error'); return; }
    let html = `<html><head><title>QR Badges</title>
      <script src="https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js"><\/script>
      <style>
        body{font-family:Arial,sans-serif}
        .badge{width:65mm;height:40mm;border:2px solid #0265B1;border-radius:6px;
          display:inline-block;margin:3mm;padding:3mm;page-break-inside:avoid;text-align:center;vertical-align:top}
        .badge h3{font-size:9px;color:#0265B1;margin:0 0 2mm 0}
        .badge .name{font-size:8px;font-weight:bold;margin-top:1mm}
        .badge .id{font-size:7px;color:#666}
      </style></head><body>`;

    learners.forEach((l, i) => {
      html += `<div class="badge"><h3>Tax Academy On-Boarding 2026</h3>
        <div id="qr${i}"></div><div class="name">${l.name}</div><div class="id">${l.staffId}</div></div>`;
    });

    html += `<script>window.onload=function(){${learners.map((l, i) =>
      `new QRCode(document.getElementById("qr${i}"),{text:"${l.staffId}",width:80,height:80,correctLevel:QRCode.CorrectLevel.M});`
    ).join('')}};<\/script></body></html>`;

    const w = window.open('', '_blank');
    w.document.write(html);
    w.document.close();
    showToast('QR badges ready — Print this page', 'success');
  };

  // ── Backup / Clear ──
  window.exportBackup = function () {
    downloadFile(JSON.stringify({ mode, mealType, setup, learners, auditLog }, null, 2),
      `URA_Backup_${setup.date || 'all'}.json`, 'application/json');
    showToast('Backup saved', 'success');
  };

  window.clearData = function () {
    if (!confirm('Delete ALL data on this device?')) return;
    if (!confirm('This cannot be undone. Are you sure?')) return;
    localStorage.removeItem(DB_KEY);
    showToast('Data cleared', 'success');
    setTimeout(() => location.reload(), 800);
  };

  function updateDataStats() {
    const el = document.getElementById('dataStats');
    const ci = learners.filter(l => l.timeIn).length;
    const bf = learners.filter(l => l.breakfast).length;
    const lu = learners.filter(l => l.lunch).length;
    el.innerHTML = `${learners.length} learners | ${ci} checked in | ${bf} breakfasts | ${lu} lunches<br>` +
      `Device: ${setup.device || '—'} | Audit: ${auditLog.length} entries | Storage: ${(localStorage.getItem(DB_KEY)||'').length} bytes`;
  }

  // ── Helpers ──
  function audit(action, staffId, name, detail) {
    auditLog.push({ time: new Date().toISOString(), device: setup.device || '?', action, staffId, name, detail });
  }

  function formatDate(d) {
    if (!d) return '';
    return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }

  function downloadFile(content, name, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type }));
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function showToast(msg, type) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast show ' + (type || '');
    setTimeout(() => t.className = 'toast', 2500);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
