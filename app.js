(() => {
  'use strict';

  const DB_KEY = 'taxacademy_db';
  let API_URL = '';
  let setup = {};
  let learners = [];
  let auditLog = [];
  let activeField = 'module1';
  let navHistory = [];
  let currentScreen = 'setup';
  let syncInterval = null;

  // Module/meal field definitions
  const FIELDS = {
    module1: { label: 'Module 1', type: 'module', value: 'present' },
    module2: { label: 'Module 2', type: 'module', value: 'present' },
    module3: { label: 'Module 3', type: 'module', value: 'present' },
    breakfast: { label: 'Breakfast', type: 'meal', value: 'Yes' },
    lunch: { label: 'Lunch', type: 'meal', value: 'Yes' }
  };

  // ── Init ──
  function init() {
    loadDB();
    updateOnlineStatus();
    window.addEventListener('online', () => { updateOnlineStatus(); syncToSheet(); });
    window.addEventListener('offline', updateOnlineStatus);

    if (setup.apiUrl) {
      API_URL = setup.apiUrl;
    }
    if (setup.session) {
      showApp();
    }

    buildSelectors();
  }

  // ── Storage ──
  function loadDB() {
    try {
      const raw = localStorage.getItem(DB_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        setup = d.setup || {};
        learners = d.learners || [];
        auditLog = d.auditLog || [];
      }
    } catch (e) {}
  }

  function saveDB() {
    localStorage.setItem(DB_KEY, JSON.stringify({ setup, learners, auditLog }));
  }

  // ── Navigation ──
  function navigateTo(screenId) {
    navHistory.push(currentScreen);
    currentScreen = screenId;
    showScreen(screenId);
    updateBackBtn();
  }

  window.goBack = function () {
    if (!navHistory.length) return;
    const prev = navHistory.pop();
    currentScreen = prev;
    showScreen(prev);
    updateBackBtn();
  };

  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));

    if (id === 'setup') {
      document.getElementById('setupScreen').classList.add('active');
      document.getElementById('tabBar').style.display = 'none';
    } else if (id === 'main') {
      document.getElementById('mainScreen').classList.add('active');
      document.getElementById('tabBar').style.display = 'flex';
      document.querySelector('.tab[data-tab="main"]').classList.add('active');
      renderList();
    } else if (id === 'search') {
      document.getElementById('searchScreen').classList.add('active');
      document.getElementById('tabBar').style.display = 'flex';
      document.querySelector('.tab[data-tab="search"]').classList.add('active');
    } else if (id === 'export') {
      document.getElementById('exportScreen').classList.add('active');
      document.getElementById('tabBar').style.display = 'flex';
      document.querySelector('.tab[data-tab="export"]').classList.add('active');
      updateDataStats();
    }
  }

  function updateBackBtn() {
    document.getElementById('backBtn').style.display =
      (navHistory.length > 0 && currentScreen !== 'setup') ? 'flex' : 'none';
  }

  // ── Setup ──
  window.saveSetup = function () {
    const date = document.getElementById('setupDate').value;
    const session = document.getElementById('setupSession').value.trim();
    const supervisor = document.getElementById('setupSupervisor').value.trim();
    const device = document.getElementById('setupDevice').value.trim();
    const apiUrl = document.getElementById('setupApiUrl').value.trim();

    if (!date || !session || !supervisor || !device) {
      showToast('Fill in all required fields', 'error');
      return;
    }

    setup = {
      date, session, supervisor, device, apiUrl,
      module1: document.getElementById('setupModule1').value.trim() || 'Module 1',
      module2: document.getElementById('setupModule2').value.trim() || 'Module 2',
      module3: document.getElementById('setupModule3').value.trim() || 'Module 3'
    };
    API_URL = apiUrl;
    saveDB();
    showApp();
  };

  function showApp() {
    navHistory = [];
    currentScreen = 'main';

    // Update labels
    document.getElementById('headerSubtitle').textContent = `${setup.session} — ${formatDate(setup.date)}`;
    FIELDS.module1.label = setup.module1 || 'Module 1';
    FIELDS.module2.label = setup.module2 || 'Module 2';
    FIELDS.module3.label = setup.module3 || 'Module 3';

    buildSelectors();
    showScreen('main');
    loadFromSheet();
    startAutoSync();
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

  // ── Selector Buttons ──
  function buildSelectors() {
    const moduleRow = document.getElementById('moduleSelectors');
    const mealRow = document.getElementById('mealSelectors');
    if (!moduleRow || !mealRow) return;

    moduleRow.innerHTML = ['module1', 'module2', 'module3'].map(f => {
      const count = learners.filter(l => l[f]).length;
      return `<button class="selector-btn ${activeField === f ? 'active' : ''}"
        onclick="selectField('${f}')">${FIELDS[f].label}<span class="count">${count}/${learners.length}</span></button>`;
    }).join('');

    mealRow.innerHTML = ['breakfast', 'lunch'].map(f => {
      const count = learners.filter(l => l[f]).length;
      return `<button class="selector-btn ${activeField === f ? 'active' : ''}"
        onclick="selectField('${f}')">${FIELDS[f].label}<span class="count">${count}/${learners.length}</span></button>`;
    }).join('');
  }

  window.selectField = function (field) {
    activeField = field;
    buildSelectors();
    renderList();
  };

  // ── Render List ──
  function renderList() {
    const thead = document.getElementById('tableHead');
    const tbody = document.getElementById('tableBody');
    const empty = document.getElementById('emptyState');
    const tableContainer = document.querySelector('#mainScreen .table-container');

    if (!learners.length) {
      empty.style.display = 'block';
      tableContainer.style.display = 'none';
      return;
    }
    empty.style.display = 'none';
    tableContainer.style.display = 'block';

    const field = activeField;
    const label = FIELDS[field].label;
    const hasTimeIn = field === 'module1' || field === 'module2' || field === 'module3';

    thead.innerHTML = `<th>S/N</th><th>Name</th><th>Staff ID</th><th>${label}</th><th>Action</th>`;

    tbody.innerHTML = learners.map((l, i) => {
      const marked = !!l[field];
      let statusText = '';
      if (marked) {
        statusText = field === 'timeIn' ? l[field] : '&#10003; Done';
      }

      return `<tr class="${marked ? 'marked' : ''}">
        <td>${l.sn}</td>
        <td>${l.name}</td>
        <td>${l.staffId}</td>
        <td>${marked ? statusText : '—'}</td>
        <td><button class="btn-mark ${marked ? 'done' : ''}" onclick="markField(${i})">
          ${marked ? '&#10003; Done' : 'Mark'}
        </button></td>
      </tr>`;
    }).join('');

    const markedCount = learners.filter(l => l[field]).length;
    document.getElementById('statsBar').textContent = `${markedCount}/${learners.length} marked for ${label}`;
    buildSelectors();
  }

  // ── Mark Field ──
  window.markField = function (idx) {
    const l = learners[idx];
    const field = activeField;

    if (l[field]) {
      showToast(`${FIELDS[field].label} already marked for ${l.name}`, 'warning');
      return;
    }

    const value = FIELDS[field].value;

    // If this is a module scan and no timeIn yet, set timeIn
    if (FIELDS[field].type === 'module' && !l.timeIn) {
      l.timeIn = new Date().toTimeString().slice(0, 5);
    }

    l[field] = value;
    l.device = setup.device;
    l.timestamp = new Date().toISOString();

    audit('MARK', l.staffId, l.name, `${field}: ${value}`);
    saveDB();
    renderList();
    showToast(`${l.name} — ${FIELDS[field].label}: Done`, 'success');

    // Sync to Google Sheet
    saveToSheet(l.staffId, field, value);
  };

  // ── Google Sheets Sync ──
  async function apiRequest(action, params) {
    if (!API_URL) return { error: 'No API URL configured' };
    try {
      const resp = await fetch(API_URL, {
        method: 'POST',
        mode: 'no-cors',
        body: JSON.stringify({ action, ...params })
      });
      // no-cors doesn't return response body, but the write still happens
      return { success: true };
    } catch (e) {
      console.error('API error:', e);
      return { error: e.message };
    }
  }

  function saveToSheet(staffId, field, value) {
    setSyncDot('syncing');
    apiRequest('save', { staffId, field, value, device: setup.device })
      .then(() => setSyncDot('online'))
      .catch(() => setSyncDot('offline'));
  }

  async function loadFromSheet() {
    if (!API_URL) return;
    setSyncDot('syncing');
    try {
      const resp = await fetch(API_URL + '?action=getLearners');
      const data = await resp.json();
      if (data.learners && data.learners.length) {
        // Merge remote data with local
        data.learners.forEach(remote => {
          const local = learners.find(l => l.staffId === remote['Staff ID']);
          if (local) {
            // Keep local changes, update from remote if remote has more data
            if (remote['Time In'] && !local.timeIn) local.timeIn = remote['Time In'];
            if (remote['Module1'] && !local.module1) local.module1 = remote['Module1'];
            if (remote['Module2'] && !local.module2) local.module2 = remote['Module2'];
            if (remote['Module3'] && !local.module3) local.module3 = remote['Module3'];
            if (remote['Breakfast'] && !local.breakfast) local.breakfast = remote['Breakfast'];
            if (remote['Lunch'] && !local.lunch) local.lunch = remote['Lunch'];
          }
        });
        saveDB();
        renderList();
      }
      setSyncDot('online');
    } catch (e) {
      console.error('Load error:', e);
      setSyncDot('offline');
    }
  }

  async function syncToSheet() {
    if (!API_URL) return;
    // Upload all local data that hasn't been synced
    for (const l of learners) {
      const fields = ['timeIn', 'module1', 'module2', 'module3', 'breakfast', 'lunch'];
      for (const f of fields) {
        if (l[f]) {
          await apiRequest('save', { staffId: l.staffId, field: f, value: l[f], device: setup.device });
        }
      }
    }
  }

  function startAutoSync() {
    if (syncInterval) clearInterval(syncInterval);
    syncInterval = setInterval(() => {
      if (navigator.onLine && API_URL) loadFromSheet();
    }, 30000); // sync every 30 seconds
  }

  function setSyncDot(state) {
    const dot = document.getElementById('syncDot');
    dot.classList.remove('offline', 'syncing');
    if (state === 'offline') dot.classList.add('offline');
    else if (state === 'syncing') dot.classList.add('syncing');
  }

  function updateOnlineStatus() {
    setSyncDot(navigator.onLine ? 'online' : 'offline');
  }

  // ── CSV Import ──
  window.importCSV = function (event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
      const lines = parseCSV(e.target.result);
      if (lines.length < 2) { showToast('CSV is empty', 'error'); return; }

      const header = lines[0].map(h => h.trim().toLowerCase());
      const snIdx = header.findIndex(h => h.includes('s/n') || h.includes('sn'));
      const staffIdx = header.findIndex(h => h.includes('staff'));
      const idxIdx = header.findIndex(h => h.includes('index'));
      const nameIdx = header.findIndex(h => h.includes('name') || h.includes('candidate'));
      const groupIdx = header.findIndex(h => h.includes('group') || h.includes('class'));

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
          group: groupIdx >= 0 ? row[groupIdx]?.trim() : '',
          timeIn: '',
          module1: '',
          module2: '',
          module3: '',
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
      renderList();

      // Upload to Google Sheet
      if (API_URL) {
        setSyncDot('syncing');
        apiRequest('initSheet').then(() => {
          learners.forEach(l => {
            apiRequest('save', { staffId: l.staffId, field: 'sn', value: l.sn, device: 'IMPORT' });
          });
          setSyncDot('online');
        });
      }
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

  // ── Search ──
  window.filterList = function () {
    const q = document.getElementById('searchInput').value.toLowerCase();
    document.querySelectorAll('#tableBody tr').forEach((row, i) => {
      const l = learners[i];
      row.style.display = (!l || l.name.toLowerCase().includes(q) || l.staffId.includes(q)) ? '' : 'none';
    });
  };

  window.globalSearchFn = function () {
    const q = document.getElementById('globalSearch').value.toLowerCase().trim();
    const c = document.getElementById('searchResults');
    if (!q) { c.innerHTML = '<p class="microcopy">Type to search...</p>'; return; }
    const hits = learners.filter(l =>
      l.name.toLowerCase().includes(q) || l.staffId.includes(q) || (l.indexNumber && l.indexNumber.toLowerCase().includes(q))
    );
    if (!hits.length) { c.innerHTML = '<p class="microcopy">No results.</p>'; return; }
    c.innerHTML = hits.slice(0, 20).map(l => `
      <div class="search-result-card">
        <h4>${l.name}</h4>
        <p>Staff ID: ${l.staffId} | Index: ${l.indexNumber || '—'} | Group: ${l.group || '—'}</p>
        <p>
          <span class="status-badge ${l.timeIn ? 'badge-done' : 'badge-pending'}">Time In: ${l.timeIn || '—'}</span>
          <span class="status-badge ${l.module1 ? 'badge-done' : 'badge-pending'}">${setup.module1 || 'Mod1'}: ${l.module1 || '—'}</span>
          <span class="status-badge ${l.module2 ? 'badge-done' : 'badge-pending'}">${setup.module2 || 'Mod2'}: ${l.module2 || '—'}</span>
          <span class="status-badge ${l.module3 ? 'badge-done' : 'badge-pending'}">${setup.module3 || 'Mod3'}: ${l.module3 || '—'}</span>
          <span class="status-badge ${l.breakfast ? 'badge-done' : 'badge-pending'}">Breakfast: ${l.breakfast || '—'}</span>
          <span class="status-badge ${l.lunch ? 'badge-done' : 'badge-pending'}">Lunch: ${l.lunch || '—'}</span>
        </p>
      </div>
    `).join('');
  };

  // ── QR Code ──
  window.openQR = function () {
    document.getElementById('qrModal').style.display = 'flex';
    document.getElementById('qrResult').innerHTML = '';
    document.getElementById('manualQR').value = '';
    document.getElementById('manualQR').focus();
  };

  window.closeQR = function () {
    document.getElementById('qrModal').style.display = 'none';
  };

  window.processQR = function (staffId) {
    staffId = staffId.trim();
    if (!staffId) return;

    const l = learners.find(x => x.staffId === staffId);
    if (!l) {
      document.getElementById('qrResult').innerHTML =
        `<div style="background:#FFF3CD;padding:10px;border-radius:8px;">Staff ID ${staffId} not found.
        <button class="btn-primary" style="margin-top:8px;width:100%"
          onclick="closeQR();openAddLearnerWithId('${staffId}')">+ Add as New Learner</button></div>`;
      return;
    }

    const idx = learners.indexOf(l);
    const field = activeField;

    if (l[field]) {
      document.getElementById('qrResult').innerHTML =
        `<div style="background:#FFF3CD;padding:10px;border-radius:8px;">${FIELDS[field].label} already marked for ${l.name}</div>`;
      return;
    }

    // Mark the field
    const value = FIELDS[field].value;
    if (FIELDS[field].type === 'module' && !l.timeIn) {
      l.timeIn = new Date().toTimeString().slice(0, 5);
    }
    l[field] = value;
    l.device = setup.device;
    l.timestamp = new Date().toISOString();

    audit('QR-SCAN', l.staffId, l.name, `${field}: ${value}`);
    saveDB();
    renderList();
    saveToSheet(l.staffId, field, value);

    document.getElementById('qrResult').innerHTML =
      `<div style="background:#D4EDDA;padding:10px;border-radius:8px;">&#10003; ${l.name} — ${FIELDS[field].label}: Done</div>`;
    document.getElementById('manualQR').value = '';

    setTimeout(() => {
      document.getElementById('qrResult').innerHTML = '';
    }, 3000);
  };

  // ── Export ──
  window.toggleExportBtns = function () {
    const ok = document.getElementById('supervisorApproval').checked;
    document.getElementById('exportAttBtn').disabled = !ok;
    document.getElementById('exportMealBtn').disabled = !ok;
  };

  window.exportAttendance = function () {
    const sig = document.getElementById('supervisorSignature').value.trim();
    if (!sig) { showToast('Enter supervisor name', 'error'); return; }

    audit('EXPORT', 'SUPERVISOR', sig, 'Attendance CSV exported');
    saveDB();

    const m1 = setup.module1 || 'Module 1';
    const m2 = setup.module2 || 'Module 2';
    const m3 = setup.module3 || 'Module 3';
    const title = `Tax Academy On-Boarding 2026 (${setup.session})`;
    const dateStr = formatDate(setup.date);

    let csv = `S/N,Index Number,Candidate Name,Staff ID,Time In,${m1},${m2},${m3}\n`;
    learners.forEach(l => {
      csv += `${l.sn},"${l.indexNumber || ''}","${l.name}","${l.staffId}","${l.timeIn || ''}","${l.module1 || ''}","${l.module2 || ''}","${l.module3 || ''}"\n`;
    });

    const header = `${title}\nDate: ${dateStr}\nSupervisor: ${sig}\n\n`;
    downloadFile(header + csv, `Attendance_${setup.date}_${setup.session.replace(/\s+/g, '_')}.csv`, 'text/csv');
    showToast('Attendance CSV downloaded', 'success');
  };

  window.exportMeals = function () {
    const sig = document.getElementById('supervisorSignature').value.trim();
    if (!sig) { showToast('Enter supervisor name', 'error'); return; }

    audit('EXPORT', 'SUPERVISOR', sig, 'Meals CSV exported');
    saveDB();

    const title = `Tax Academy On-Boarding 2026 (${setup.session})`;
    const dateStr = formatDate(setup.date);

    let csv = 'S/N,Candidate Name,Staff ID,Breakfast,Lunch\n';
    learners.forEach(l => {
      csv += `${l.sn},"${l.name}","${l.staffId}","${l.breakfast || ''}","${l.lunch || ''}"\n`;
    });

    const header = `${title}\nDate: ${dateStr}\nSupervisor: ${sig}\n\n`;
    downloadFile(header + csv, `Meals_${setup.date}_${setup.session.replace(/\s+/g, '_')}.csv`, 'text/csv');
    showToast('Meals CSV downloaded', 'success');
  };

  // ── Backup / Clear ──
  window.exportBackup = function () {
    downloadFile(JSON.stringify({ setup, learners, auditLog }, null, 2),
      `TaxAcademy_Backup_${setup.date || 'all'}.json`, 'application/json');
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
    const mod1 = learners.filter(l => l.module1).length;
    const mod2 = learners.filter(l => l.module2).length;
    const mod3 = learners.filter(l => l.module3).length;
    const bf = learners.filter(l => l.breakfast).length;
    const lu = learners.filter(l => l.lunch).length;
    el.innerHTML = `${learners.length} learners<br>` +
      `${setup.module1 || 'Mod1'}: ${mod1} | ${setup.module2 || 'Mod2'}: ${mod2} | ${setup.module3 || 'Mod3'}: ${mod3}<br>` +
      `Breakfast: ${bf} | Lunch: ${lu}<br>` +
      `Device: ${setup.device || '—'} | Audit: ${auditLog.length} entries`;
  }

  // ── Add Learner (on-the-fly) ──
  window.openAddLearner = function () {
    document.getElementById('addLearnerModal').style.display = 'flex';
    document.getElementById('addResult').innerHTML = '';
    document.getElementById('addName').value = '';
    document.getElementById('addStaffId').value = '';
    document.getElementById('addIndex').value = '';
    document.getElementById('addGroup').value = '';
    document.getElementById('addName').focus();
  };

  window.openAddLearnerWithId = function (staffId) {
    document.getElementById('addLearnerModal').style.display = 'flex';
    document.getElementById('addResult').innerHTML = '';
    document.getElementById('addName').value = '';
    document.getElementById('addStaffId').value = staffId;
    document.getElementById('addIndex').value = '';
    document.getElementById('addGroup').value = '';
    document.getElementById('addName').focus();
  };

  window.closeAddLearner = function () {
    document.getElementById('addLearnerModal').style.display = 'none';
  };

  window.addNewLearner = function () {
    const name = document.getElementById('addName').value.trim();
    const staffId = document.getElementById('addStaffId').value.trim();
    const indexNumber = document.getElementById('addIndex').value.trim();
    const group = document.getElementById('addGroup').value.trim();

    if (!name || !staffId) {
      document.getElementById('addResult').innerHTML =
        '<div style="background:#FFF3CD;padding:10px;border-radius:8px;">Name and Staff ID are required</div>';
      return;
    }

    if (learners.find(l => l.staffId === staffId)) {
      document.getElementById('addResult').innerHTML =
        `<div style="background:#FFF3CD;padding:10px;border-radius:8px;">Staff ID ${staffId} already exists</div>`;
      return;
    }

    const newLearner = {
      sn: learners.length + 1,
      indexNumber,
      name,
      staffId,
      group,
      timeIn: '',
      module1: '',
      module2: '',
      module3: '',
      breakfast: '',
      lunch: '',
      device: '',
      timestamp: ''
    };

    learners.push(newLearner);
    saveDB();
    audit('ADD-LEARNER', staffId, name, 'Added on-the-fly');
    renderList();

    // Sync to Google Sheet
    apiRequest('addLearner', {
      sn: newLearner.sn,
      indexNumber,
      name,
      staffId,
      group
    });

    document.getElementById('addResult').innerHTML =
      `<div style="background:#D4EDDA;padding:10px;border-radius:8px;">&#10003; ${name} added successfully</div>`;

    setTimeout(() => {
      document.getElementById('addLearnerModal').style.display = 'none';
    }, 1500);
  };

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
