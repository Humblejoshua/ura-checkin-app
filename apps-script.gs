// ============================================================
// Tax Academy On-Boarding — Google Apps Script API
// ============================================================
// Deploy as: Web App -> Execute as: Me -> Who has access: Anyone
// ============================================================
//
// HOW TO SET UP:
// 1. Create a Google Sheet named "Tax Academy On-Boarding Tracker"
// 2. Create these tabs: Config, Learners, Audit Log, Export Attendance, Export Meals
// 3. Go to Extensions > Apps Script
// 4. Delete any existing code
// 5. Paste THIS ENTIRE SCRIPT
// 6. Click Save
// 7. Click Deploy > New deployment > Web app
//    - Execute as: Me
//    - Who has access: Anyone
// 8. Copy the Web app URL — this is what the phones use
// 9. Put that URL in the app.js config (API_URL constant)
//
// TAB STRUCTURE:
//
// Config tab:
//   A1: Date        B1: (date)
//   A2: Session     B2: F Class 12 RM 3
//   A3: Module 1    B3: Module 1
//   A4: Module 2    B4: Module 2
//   A5: Module 3    B5: Module 3
//   A6: Supervisor  B6: (name)
//   A7: Approved    B7: FALSE
//   A8: Approved By B8: (name)
//
// Learners tab headers (Row 1) — FINAL LAYOUT:
//   A: S/N | B: Index Number | C: Candidate Name | D: Staff ID | E: Group
//   F: Date | G: Time In | H: Module1 | I: Module2 | J: Module3
//   K: Breakfast | L: Lunch | M: Device | N: Timestamp
//
// Audit Log tab headers (Row 1):
//   Timestamp | Device | Action | Staff ID | Name | Detail | Supervisor
//
// ============================================================

// ── Helpers: Sheet & Column Utilities ──

function getLearnersSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName('Learners');
}

function getConfigSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName('Config');
}

function getHeaders_(sheet) {
  var data = sheet.getDataRange().getValues();
  if (!data || data.length === 0) return { headers: [], data: [] };
  var headers = data[0].map(function(h) { return String(h).trim(); });
  return { headers: headers, data: data };
}

// ── Ensure Date column exists at column F (index 5) ──

function ensureDateColumn_() {
  var sheet = getLearnersSheet_();
  if (!sheet) return -1;

  var info = getHeaders_(sheet);
  var headers = info.headers;

  // Already present — return index
  var idx = headers.indexOf('Date');
  if (idx >= 0) return idx;

  // Not present — insert after Group (col 5 = E)
  sheet.insertColumnAfter(5);
  SpreadsheetApp.flush();

  // Set header
  sheet.getRange(1, 6).setValue('Date').setFontWeight('bold').setBackground('#0265B1').setFontColor('white');
  SpreadsheetApp.flush();

  // Backfill existing rows with date from Config B1
  try {
    var config = getConfigSheet_();
    if (config) {
      var cfgDate = String(config.getRange('B1').getValue() || '');
      if (cfgDate) {
        var lastRow = sheet.getLastRow();
        if (lastRow > 1) {
          sheet.getRange(2, 6, lastRow - 1).setValue(cfgDate);
        }
      }
    }
  } catch (e) {}

  SpreadsheetApp.flush();

  // Re-read headers after insert
  info = getHeaders_(sheet);
  headers = info.headers;
  return headers.indexOf('Date');
}

// ── Find row by Staff ID + Date ──

function findRowByStaffIdAndDate_(sheet, staffId, recordDate, dateCol, staffIdCol) {
  if (!sheet || !staffId) return -1;
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][staffIdCol]).trim() === staffId) {
      if (dateCol >= 0 && recordDate) {
        if (String(data[i][dateCol]).trim() === recordDate) {
          return i + 1; // 1-indexed row number
        }
      }
    }
  }
  return -1;
}

// ── Reload column indices after sheet mutation ──

function reloadColIndexes_(sheet, field) {
  var info = getHeaders_(sheet);
  return {
    headers: info.headers,
    data: info.data,
    staffIdCol: info.headers.indexOf('Staff ID'),
    dateCol: info.headers.indexOf('Date'),
    colIdx: info.headers.indexOf(sheetFieldName(field)),
    snCol: info.headers.indexOf('S/N'),
    nameCol: info.headers.indexOf('Candidate Name'),
    idxCol: info.headers.indexOf('Index Number'),
    groupCol: info.headers.indexOf('Group'),
    deviceCol: info.headers.indexOf('Device'),
    tsCol: info.headers.indexOf('Timestamp')
  };
}

// ── Map app field names to sheet header names ──

function sheetFieldName(field) {
  var map = {
    'timeIn': 'Time In',
    'module1': 'Module1',
    'module2': 'Module2',
    'module3': 'Module3',
    'breakfast': 'Breakfast',
    'lunch': 'Lunch'
  };
  return map[field] || field;
}

// ── Web App Entry Points ──

function doGet(e) {
  if (!e || !e.parameter) {
    return ContentService.createTextOutput(JSON.stringify({ error: 'No parameters provided' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  return handleRequest(e.parameter, 'GET');
}

function doPost(e) {
  if (!e || !e.postData) {
    return ContentService.createTextOutput(JSON.stringify({ error: 'No post data provided' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  return handleRequest(JSON.parse(e.postData.contents), 'POST');
}

function handleRequest(params, method) {
  var action = params.action || '';
  var result;
  switch (action) {
    case 'getLearners':  result = getLearners(params); break;
    case 'getConfig':    result = getConfig(); break;
    case 'getStats':     result = getStats(); break;
    case 'save':         result = saveRecord(params); break;
    case 'checkDupe':    result = checkDuplicate(params); break;
    case 'approve':      result = approve(params); break;
    case 'initSheet':    result = initSheet(); break;
    case 'addLearner':   result = addLearner(params); break;
    case 'updateConfig': result = updateConfig(params); break;
    default:             result = { error: 'Unknown action: ' + action };
  }
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── GET: Fetch all learners ──

function getLearners(params) {
  var sheet = getLearnersSheet_();
  if (!sheet) return { learners: [], error: 'Learners sheet not found' };

  var info = getHeaders_(sheet);
  if (info.data.length < 2) return { learners: [] };

  var headers = info.headers;
  var learners = [];

  for (var i = 1; i < info.data.length; i++) {
    var row = info.data[i];
    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      obj[headers[j]] = row[j] !== undefined ? String(row[j]) : '';
    }
    learners.push(obj);
  }

  return { learners: learners };
}

// ── GET: Fetch config ──

function getConfig() {
  var sheet = getConfigSheet_();
  if (!sheet) return { error: 'Config sheet not found' };

  return {
    date: String(sheet.getRange('B1').getValue() || ''),
    session: String(sheet.getRange('B2').getValue() || ''),
    module1: String(sheet.getRange('B3').getValue() || 'Module 1'),
    module2: String(sheet.getRange('B4').getValue() || 'Module 2'),
    module3: String(sheet.getRange('B5').getValue() || 'Module 3'),
    supervisor: String(sheet.getRange('B6').getValue() || ''),
    approved: sheet.getRange('B7').getValue(),
    approvedBy: String(sheet.getRange('B8').getValue() || '')
  };
}

// ── POST: Update module names in Config ──

function updateConfig(params) {
  var sheet = getConfigSheet_();
  if (!sheet) return { error: 'Config sheet not found' };

  if (params.date) sheet.getRange('B1').setValue(params.date);
  if (params.session) sheet.getRange('B2').setValue(params.session);
  if (params.module1) sheet.getRange('B3').setValue(params.module1);
  if (params.module2) sheet.getRange('B4').setValue(params.module2);
  if (params.module3) sheet.getRange('B5').setValue(params.module3);
  if (params.supervisor) sheet.getRange('B6').setValue(params.supervisor);
  if (params.device) sheet.getRange('B8').setValue(params.device);

  // Update Export Attendance tab headers with module names
  var expAtt = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Export Attendance');
  if (expAtt) {
    if (params.module1) expAtt.getRange('F3').setValue(params.module1);
    if (params.module2) expAtt.getRange('G3').setValue(params.module2);
    if (params.module3) expAtt.getRange('H3').setValue(params.module3);
  }

  return { success: true, message: 'Config updated' };
}

// ── GET: Live stats (filtered to Config date) ──

function getStats() {
  var sheet = getLearnersSheet_();
  if (!sheet) return { total: 0, timeIn: 0, module1: 0, module2: 0, module3: 0, breakfast: 0, lunch: 0 };

  var config = getConfigSheet_();
  var targetDate = '';
  if (config) targetDate = String(config.getRange('B1').getValue() || '').trim();

  var info = getHeaders_(sheet);
  if (info.data.length < 2) return { total: 0, timeIn: 0, module1: 0, module2: 0, module3: 0, breakfast: 0, lunch: 0 };

  var dateCol = info.headers.indexOf('Date');
  var stats = { total: 0, timeIn: 0, module1: 0, module2: 0, module3: 0, breakfast: 0, lunch: 0 };

  for (var i = 1; i < info.data.length; i++) {
    // If Date column exists and target date is set, only count matching rows
    if (dateCol >= 0 && targetDate) {
      if (String(info.data[i][dateCol]).trim() !== targetDate) continue;
    }
    stats.total++;
    if (info.data[i][6]) stats.timeIn++;     // G: Time In
    if (info.data[i][7]) stats.module1++;    // H: Module1
    if (info.data[i][8]) stats.module2++;    // I: Module2
    if (info.data[i][9]) stats.module3++;    // J: Module3
    if (info.data[i][10]) stats.breakfast++; // K: Breakfast
    if (info.data[i][11]) stats.lunch++;     // L: Lunch
  }

  return stats;
}

// ── POST: Save a record ──

function saveRecord(params) {
  var staffId = String(params.staffId || '').trim();
  var field = String(params.field || '').trim();
  var value = String(params.value || '').trim();
  var device = String(params.device || '').trim();
  var recordDate = String(params.date || '').trim();

  if (!staffId || !field) return { error: 'staffId and field are required' };
  if (!recordDate) return { error: 'date is required for per-day records' };

  var sheet = getLearnersSheet_();
  if (!sheet) return { error: 'Learners sheet not found' };

  // Ensure Date column exists
  var dateCol = ensureDateColumn_();

  // Reload all column indices after potential column insert
  var cols = reloadColIndexes_(sheet, field);
  dateCol = cols.dateCol;

  if (cols.colIdx === -1) return { error: 'Field not found in sheet: ' + sheetFieldName(field) };
  if (cols.staffIdCol === -1) return { error: 'Staff ID column not found' };
  if (dateCol === -1) return { error: 'Date column not found' };

  // Find existing row for this Staff ID + Date
  var targetRow = findRowByStaffIdAndDate_(sheet, staffId, recordDate, dateCol, cols.staffIdCol);

  // If no row found, create one
  if (targetRow === -1) {
    // Find any existing row for this Staff ID (from any day) to copy learner info
    var allData = sheet.getDataRange().getValues();
    var learnerInfo = null;
    for (var i = 1; i < allData.length; i++) {
      if (String(allData[i][cols.staffIdCol]).trim() === staffId) {
        learnerInfo = allData[i];
        break;
      }
    }
    if (!learnerInfo) return { error: 'Staff ID not found: ' + staffId, found: false };

    var newRow = new Array(cols.headers.length).fill('');
    if (cols.snCol >= 0) newRow[cols.snCol] = learnerInfo[cols.snCol];
    if (cols.idxCol >= 0) newRow[cols.idxCol] = learnerInfo[cols.idxCol];
    if (cols.nameCol >= 0) newRow[cols.nameCol] = learnerInfo[cols.nameCol];
    if (cols.staffIdCol >= 0) newRow[cols.staffIdCol] = staffId;
    if (cols.groupCol >= 0) newRow[cols.groupCol] = learnerInfo[cols.groupCol];
    newRow[dateCol] = recordDate;
    newRow[cols.colIdx] = value;
    if (cols.deviceCol >= 0) newRow[cols.deviceCol] = device;
    if (cols.tsCol >= 0) newRow[cols.tsCol] = new Date();

    sheet.appendRow(newRow);
    targetRow = sheet.getLastRow();

    var name = learnerInfo[cols.nameCol] || staffId;
    logToAudit(field.toUpperCase(), device, name, field + ': ' + value + ' (new day row)');
    return { success: true, staffId: staffId, name: name, field: field, value: value, newDayRow: true };
  }

  // Row found — check if field already set
  var currentValue = String(sheet.getRange(targetRow, cols.colIdx + 1).getValue()).trim();
  if (currentValue !== '') {
    return {
      success: false,
      alreadySet: true,
      message: field + ' already recorded for ' + staffId + ' (' + currentValue + ')',
      value: currentValue
    };
  }

  // Write the value
  sheet.getRange(targetRow, cols.colIdx + 1).setValue(value);

  // Update device and timestamp
  if (cols.tsCol >= 0) sheet.getRange(targetRow, cols.tsCol + 1).setValue(new Date());
  if (cols.deviceCol >= 0) sheet.getRange(targetRow, cols.deviceCol + 1).setValue(device);

  // Get name for audit
  var allData = sheet.getDataRange().getValues();
  var name = (cols.nameCol >= 0) ? String(allData[targetRow - 1][cols.nameCol]) : staffId;

  logToAudit(field.toUpperCase(), device, name, field + ': ' + value);

  return { success: true, staffId: staffId, name: name, field: field, value: value };
}

// ── POST: Add new learner on-the-fly ──

function addLearner(params) {
  var sn = String(params.sn || '').trim();
  var name = String(params.name || '').trim();
  var staffId = String(params.staffId || '').trim();
  var indexNumber = String(params.indexNumber || '').trim();
  var group = String(params.group || '').trim();
  var recordDate = String(params.date || '').trim();

  if (!name || !staffId) return { error: 'name and staffId are required' };
  if (!recordDate) return { error: 'date is required' };

  var sheet = getLearnersSheet_();
  if (!sheet) return { error: 'Learners sheet not found' };

  // Ensure Date column exists
  ensureDateColumn_();

  // Reload column indices
  var cols = reloadColIndexes_(sheet, '');
  var dateCol = cols.dateCol;

  // Check duplicate by Staff ID + Date
  var existingRow = findRowByStaffIdAndDate_(sheet, staffId, recordDate, dateCol, cols.staffIdCol);
  if (existingRow > 0) {
    return { error: 'Staff ID already exists for this date', duplicate: true };
  }

  // Append new row
  var row = new Array(cols.headers.length).fill('');
  if (cols.snCol >= 0) row[cols.snCol] = sn;
  if (cols.nameCol >= 0) row[cols.nameCol] = name;
  if (cols.staffIdCol >= 0) row[cols.staffIdCol] = staffId;
  if (cols.idxCol >= 0) row[cols.idxCol] = indexNumber;
  if (cols.groupCol >= 0) row[cols.groupCol] = group;
  if (dateCol >= 0) row[dateCol] = recordDate;

  sheet.appendRow(row);

  logToAudit('ADD-LEARNER', 'APP', name, 'Added on-the-fly: ' + staffId);

  return { success: true, message: name + ' added', staffId: staffId };
}

// ── POST: Check duplicate ──

function checkDuplicate(params) {
  var staffId = String(params.staffId || '').trim();
  var field = String(params.field || '').trim();
  var recordDate = String(params.date || '').trim();

  if (!staffId || !field) return { error: 'staffId and field are required' };

  var sheet = getLearnersSheet_();
  if (!sheet) return { error: 'Learners sheet not found' };

  ensureDateColumn_();

  var cols = reloadColIndexes_(sheet, field);
  var dateCol = cols.dateCol;

  if (cols.colIdx === -1) return { error: 'Field not found: ' + field };

  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][cols.staffIdCol]).trim() === staffId) {
      if (dateCol >= 0) {
        var rowDate = String(data[i][dateCol]).trim();
        if (!recordDate || rowDate === recordDate) {
          var val = String(data[i][cols.colIdx]).trim();
          return { exists: val !== '', value: val };
        }
      } else {
        var val2 = String(data[i][cols.colIdx]).trim();
        return { exists: val2 !== '', value: val2 };
      }
    }
  }

  return { exists: false, value: '' };
}

// ── POST: Supervisor approval ──

function approve(params) {
  var name = String(params.name || '').trim();
  if (!name) return { error: 'Supervisor name is required' };

  var sheet = getConfigSheet_();
  if (!sheet) return { error: 'Config sheet not found' };

  sheet.getRange('B7').setValue(true);
  sheet.getRange('B8').setValue(name);
  sheet.getRange('B6').setValue(name);

  logToAudit('APPROVAL', 'SUPERVISOR', name, 'Daily data approved and locked');

  return { success: true, message: 'Approved by ' + name };
}

// ── Initialize sheet with headers ──

function initSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // Config tab
  var config = ss.getSheetByName('Config');
  if (!config) {
    config = ss.insertSheet('Config');
  }
  config.clear();
  config.getRange('A1:B10').setValues([
    ['Date', ''],
    ['Session', 'F Class 12 RM 3'],
    ['Module 1', 'Module 1'],
    ['Module 2', 'Module 2'],
    ['Module 3', 'Module 3'],
    ['Supervisor', ''],
    ['Approved', false],
    ['Approved By', ''],
    ['Export Start Date', ''],
    ['Export End Date', '']
  ]);
  config.getRange('A1:A8').setFontWeight('bold');

  // Learners tab
  var learners = ss.getSheetByName('Learners');
  if (!learners) {
    learners = ss.insertSheet('Learners');
  }
  learners.clear();
  var headers = [['S/N', 'Index Number', 'Candidate Name', 'Staff ID', 'Group', 'Date', 'Time In', 'Module1', 'Module2', 'Module3', 'Breakfast', 'Lunch', 'Device', 'Timestamp']];
  learners.getRange(1, 1, 1, 14).setValues(headers);
  learners.getRange(1, 1, 1, 14).setFontWeight('bold').setBackground('#0265B1').setFontColor('white');
  learners.setFrozenRows(1);

  // Audit Log tab
  var audit = ss.getSheetByName('Audit Log');
  if (!audit) {
    audit = ss.insertSheet('Audit Log');
  }
  audit.clear();
  var auditHeaders = [['Timestamp', 'Device', 'Action', 'Staff ID', 'Name', 'Detail', 'Supervisor']];
  audit.getRange(1, 1, 1, 7).setValues(auditHeaders);
  audit.getRange(1, 1, 1, 7).setFontWeight('bold').setBackground('#0265B1').setFontColor('white');
  audit.setFrozenRows(1);

  // Export Attendance tab
  var expAtt = ss.getSheetByName('Export Attendance');
  if (!expAtt) {
    expAtt = ss.insertSheet('Export Attendance');
  }
  expAtt.clear();
  expAtt.getRange('A1').setFormula('=IF(Config!B2="","",CONCATENATE("Tax Academy On-Boarding 2026 (",Config!B2,")"))');
  expAtt.getRange('A1').setFontSize(14).setFontWeight('bold').setFontColor('#0265B1');
  expAtt.getRange('A1:H1').merge();
  expAtt.getRange('A2').setValue('=IF(Config!B1="","","Date: "&TEXT(Config!B1,"dddd, d mmmm yyyy"))');
  expAtt.getRange('A2:H2').merge();
  var attExportHeaders = [['S/N', 'Index Number', 'Candidate Name', 'Staff ID', 'Time In', '', '', '']];
  expAtt.getRange(3, 1, 1, 8).setValues(attExportHeaders);
  expAtt.getRange(3, 1, 1, 8).setFontWeight('bold').setBackground('#0265B1').setFontColor('white');
  expAtt.getRange('F3').setFormula('=IF(Config!B3="","Module 1",Config!B3)');
  expAtt.getRange('G3').setFormula('=IF(Config!B4="","Module 2",Config!B4)');
  expAtt.getRange('H3').setFormula('=IF(Config!B5="","Module 3",Config!B5)');
  for (var r = 0; r < 600; r++) {
    var row = r + 4;
    expAtt.getRange(row, 1).setValue('=IF(Learners!A' + (r + 2) + '="","",Learners!A' + (r + 2) + ')');
    expAtt.getRange(row, 2).setValue('=IF(Learners!B' + (r + 2) + '="","",Learners!B' + (r + 2) + ')');
    expAtt.getRange(row, 3).setValue('=IF(Learners!C' + (r + 2) + '="","",Learners!C' + (r + 2) + ')');
    expAtt.getRange(row, 4).setValue('=IF(Learners!D' + (r + 2) + '="","",Learners!D' + (r + 2) + ')');
    expAtt.getRange(row, 5).setValue('=IF(Learners!G' + (r + 2) + '="","",Learners!G' + (r + 2) + ')');
    expAtt.getRange(row, 6).setValue('=IF(Learners!H' + (r + 2) + '="","",Learners!H' + (r + 2) + ')');
    expAtt.getRange(row, 7).setValue('=IF(Learners!I' + (r + 2) + '="","",Learners!I' + (r + 2) + ')');
    expAtt.getRange(row, 8).setValue('=IF(Learners!J' + (r + 2) + '="","",Learners!J' + (r + 2) + ')');
  }

  // Export Meals tab
  var expMeals = ss.getSheetByName('Export Meals');
  if (!expMeals) {
    expMeals = ss.insertSheet('Export Meals');
  }
  expMeals.clear();
  expMeals.getRange('A1').setFormula('=IF(Config!B2="","",CONCATENATE("Tax Academy On-Boarding 2026 (",Config!B2,")"))');
  expMeals.getRange('A1').setFontSize(14).setFontWeight('bold').setFontColor('#0265B1');
  expMeals.getRange('A1:E1').merge();
  expMeals.getRange('A2').setValue('=IF(Config!B1="","","Date: "&TEXT(Config!B1,"dddd, d mmmm yyyy"))');
  expMeals.getRange('A2:E2').merge();
  var mealExportHeaders = [['S/N', 'Candidate Name', 'Staff ID', 'Breakfast', 'Lunch']];
  expMeals.getRange(3, 1, 1, 5).setValues(mealExportHeaders);
  expMeals.getRange(3, 1, 1, 5).setFontWeight('bold').setBackground('#0265B1').setFontColor('white');
  for (var r2 = 0; r2 < 600; r2++) {
    var row2 = r2 + 4;
    expMeals.getRange(row2, 1).setValue('=IF(Learners!A' + (r2 + 2) + '="","",Learners!A' + (r2 + 2) + ')');
    expMeals.getRange(row2, 2).setValue('=IF(Learners!C' + (r2 + 2) + '="","",Learners!C' + (r2 + 2) + ')');
    expMeals.getRange(row2, 3).setValue('=IF(Learners!D' + (r2 + 2) + '="","",Learners!D' + (r2 + 2) + ')');
    expMeals.getRange(row2, 4).setValue('=IF(Learners!K' + (r2 + 2) + '="","",Learners!K' + (r2 + 2) + ')');
    expMeals.getRange(row2, 5).setValue('=IF(Learners!L' + (r2 + 2) + '="","",Learners!L' + (r2 + 2) + ')');
  }

  return { success: true, message: 'All tabs created with headers and formulas' };
}

// ── Export Attendance CSV ──

function exportAttendanceCSV() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var config = getConfigSheet_();
  var learners = getLearnersSheet_();
  if (!config || !learners) { SpreadsheetApp.getUi().alert('Config or Learners tab missing'); return; }

  var approved = config.getRange('B7').getValue();
  if (!approved) { SpreadsheetApp.getUi().alert('Supervisor must approve first.'); return; }

  var date = config.getRange('B1').getValue();
  var session = config.getRange('B2').getValue();
  var m1 = config.getRange('B3').getValue();
  var m2 = config.getRange('B4').getValue();
  var m3 = config.getRange('B5').getValue();
  var supervisor = config.getRange('B8').getValue();
  var startDate = config.getRange('B9').getValue();
  var endDate = config.getRange('B10').getValue();
  var dateStr = Utilities.formatDate(date, Session.getScriptTimeZone(), 'EEEE, d MMMM yyyy');

  var data = learners.getDataRange().getValues();
  var csv = 'S/N,Index Number,Candidate Name,Staff ID,Date,Time In,' + m1 + ',' + m2 + ',' + m3 + '\n';
  for (var i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    if (!isWithinDateRange(data[i][13], startDate, endDate)) continue;
    csv += data[i][0] + ',"' + data[i][1] + '","' + data[i][2] + '","' + data[i][3] + '","' + (data[i][5] || '') + '","' + (data[i][6] || '') + '","' + (data[i][7] || '') + '","' + (data[i][8] || '') + '","' + (data[i][9] || '') + '"\n';
  }

  var rangeLabel = '';
  if (startDate && endDate) rangeLabel = '_' + Utilities.formatDate(startDate, Session.getScriptTimeZone(), 'yyyy-MM-dd') + '_to_' + Utilities.formatDate(endDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  else if (startDate) rangeLabel = '_from_' + Utilities.formatDate(startDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  else rangeLabel = '_' + Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');

  var title = 'Tax Academy On-Boarding 2026 (' + session + ')';
  var header = title + '\nDate: ' + dateStr + '\nSupervisor: ' + supervisor + '\n\n';
  var blob = Utilities.newBlob(header + csv, 'text/csv', 'Attendance' + rangeLabel + '.csv');
  var folder = getExportFolder();
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  SpreadsheetApp.getUi().alert('Exported!\n' + file.getUrl());
}

// ── Export Meals CSV ──

function exportMealsCSV() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var config = getConfigSheet_();
  var learners = getLearnersSheet_();
  if (!config || !learners) { SpreadsheetApp.getUi().alert('Config or Learners tab missing'); return; }

  var approved = config.getRange('B7').getValue();
  if (!approved) { SpreadsheetApp.getUi().alert('Supervisor must approve first.'); return; }

  var date = config.getRange('B1').getValue();
  var session = config.getRange('B2').getValue();
  var supervisor = config.getRange('B8').getValue();
  var startDate = config.getRange('B9').getValue();
  var endDate = config.getRange('B10').getValue();
  var dateStr = Utilities.formatDate(date, Session.getScriptTimeZone(), 'EEEE, d MMMM yyyy');

  var data = learners.getDataRange().getValues();
  var csv = 'S/N,Candidate Name,Staff ID,Date,Breakfast,Lunch\n';
  for (var i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    if (!isWithinDateRange(data[i][13], startDate, endDate)) continue;
    csv += data[i][0] + ',"' + data[i][2] + '","' + data[i][3] + '","' + (data[i][5] || '') + '","' + (data[i][10] || '') + '","' + (data[i][11] || '') + '"\n';
  }

  var rangeLabel = '';
  if (startDate && endDate) rangeLabel = '_' + Utilities.formatDate(startDate, Session.getScriptTimeZone(), 'yyyy-MM-dd') + '_to_' + Utilities.formatDate(endDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  else if (startDate) rangeLabel = '_from_' + Utilities.formatDate(startDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  else rangeLabel = '_' + Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');

  var title = 'Tax Academy On-Boarding 2026 (' + session + ')';
  var header = title + '\nDate: ' + dateStr + '\nSupervisor: ' + supervisor + '\n\n';
  var blob = Utilities.newBlob(header + csv, 'text/csv', 'Meals' + rangeLabel + '.csv');
  var folder = getExportFolder();
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  SpreadsheetApp.getUi().alert('Exported!\n' + file.getUrl());
}

// ── Helpers: Export folder + date range ──

function getExportFolder() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var parent = DriveApp.getFileById(ss.getId()).getParents().next();
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var folderName = 'TaxAcademy_Exports_' + today;
  var folders = parent.getFoldersByName(folderName);
  if (folders.hasNext()) return folders.next();
  var folder = parent.createFolder(folderName);
  folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return folder;
}

function isWithinDateRange(rowTimestamp, startDate, endDate) {
  if (!startDate && !endDate) return true;
  if (!rowTimestamp) return true;
  var ts = new Date(rowTimestamp);
  if (isNaN(ts.getTime())) return true;
  if (startDate && ts < new Date(startDate)) return false;
  if (endDate) {
    var end = new Date(endDate);
    end.setHours(23, 59, 59);
    if (ts > end) return false;
  }
  return true;
}

// ── Audit Log Helper ──

function logToAudit(action, device, name, detail) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var audit = ss.getSheetByName('Audit Log');
  if (!audit) return;

  var supervisor = '';
  try {
    var config = getConfigSheet_();
    if (config) supervisor = String(config.getRange('B6').getValue() || '');
  } catch (e) {}

  audit.appendRow([new Date(), device, action, '', name, detail, supervisor]);
}

// ── Menu (runs when sheet opens) ──

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Tax Academy')
    .item('Initialize Sheet', 'initSheet')
    .item('Update Export Headers', 'updateExportHeadersUI')
    .item('Export Attendance CSV', 'exportAttendanceCSV')
    .item('Export Meals CSV', 'exportMealsCSV')
    .item('Approve & Lock', 'approveAndLockUI')
    .addToUi();
}

// ── UI: Update Export Attendance headers ──

function updateExportHeadersUI() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var config = getConfigSheet_();
  var expAtt = ss.getSheetByName('Export Attendance');
  if (!config || !expAtt) {
    SpreadsheetApp.getUi().alert('Config or Export Attendance tab not found');
    return;
  }
  var m1 = String(config.getRange('B3').getValue() || 'Module 1');
  var m2 = String(config.getRange('B4').getValue() || 'Module 2');
  var m3 = String(config.getRange('B5').getValue() || 'Module 3');
  expAtt.getRange('F3').setValue(m1);
  expAtt.getRange('G3').setValue(m2);
  expAtt.getRange('H3').setValue(m3);
  SpreadsheetApp.getUi().alert('Headers updated to: ' + m1 + ' | ' + m2 + ' | ' + m3);
}

// ── UI: Approve & Lock ──

function approveAndLockUI() {
  var config = getConfigSheet_();
  var ui = SpreadsheetApp.getUi();

  var response = ui.prompt('Supervisor Approval', 'Type your name:', ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;

  var name = response.getResponseText().trim();
  if (!name) { ui.alert('Name required.'); return; }

  config.getRange('B7').setValue(true);
  config.getRange('B8').setValue(name);
  config.getRange('B6').setValue(name);
  logToAudit('APPROVAL', 'SUPERVISOR', name, 'Approved');
  ui.alert('Approved by ' + name + '. Exports enabled.');
}
