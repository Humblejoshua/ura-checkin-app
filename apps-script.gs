// ============================================================
// Tax Academy On-Boarding — Google Apps Script API
// ============================================================
// Deploy as: Web App → Execute as: Me → Who has access: Anyone
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
// Learners tab headers (Row 1):
//   S/N | Index Number | Candidate Name | Staff ID | Time In | Module1 | Module2 | Module3 | Breakfast | Lunch | Device | Timestamp
//
// Audit Log tab headers (Row 1):
//   Timestamp | Device | Action | Staff ID | Name | Detail | Supervisor
//
// ============================================================

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
    case 'getStats':     result = getStats(params); break;
    case 'save':         result = saveRecord(params); break;
    case 'checkDupe':    result = checkDuplicate(params); break;
    case 'approve':      result = approve(params); break;
    case 'initSheet':    result = initSheet(); break;
    case 'addLearner':   result = addLearner(params); break;
    default:             result = { error: 'Unknown action: ' + action };
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── GET: Fetch all learners ──

function getLearners(params) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Learners');
  if (!sheet) return { learners: [], error: 'Learners sheet not found' };

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return { learners: [] };

  var headers = data[0].map(function(h) { return String(h).trim(); });
  var learners = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
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
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Config');
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

// ── GET: Live stats ──

function getStats(params) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Learners');
  if (!sheet) return { total: 0, timeIn: 0, module1: 0, module2: 0, module3: 0, breakfast: 0, lunch: 0 };

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return { total: 0, timeIn: 0, module1: 0, module2: 0, module3: 0, breakfast: 0, lunch: 0 };

  var stats = { total: data.length - 1, timeIn: 0, module1: 0, module2: 0, module3: 0, breakfast: 0, lunch: 0 };

  for (var i = 1; i < data.length; i++) {
    if (data[i][5]) stats.timeIn++;     // F: Time In
    if (data[i][6]) stats.module1++;    // G: Module1
    if (data[i][7]) stats.module2++;    // H: Module2
    if (data[i][8]) stats.module3++;    // I: Module3
    if (data[i][9]) stats.breakfast++;  // J: Breakfast
    if (data[i][10]) stats.lunch++;     // K: Lunch
  }

  return stats;
}

// ── POST: Save a record ──

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

function saveRecord(params) {
  var staffId = String(params.staffId || '').trim();
  var field = String(params.field || '').trim();
  var value = String(params.value || '').trim();
  var device = String(params.device || '').trim();

  if (!staffId || !field) return { error: 'staffId and field are required' };

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Learners');
  if (!sheet) return { error: 'Learners sheet not found' };

  var data = sheet.getDataRange().getValues();
  var headers = data[0].map(function(h) { return String(h).trim(); });

  // Map app field name to sheet header name
  var sheetField = sheetFieldName(field);
  var colIdx = headers.indexOf(sheetField);
  if (colIdx === -1) return { error: 'Field not found in sheet: ' + sheetField };

  // Find the learner row by Staff ID
  var staffIdCol = headers.indexOf('Staff ID');
  var targetRow = -1;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][staffIdCol]).trim() === staffId) {
      targetRow = i + 1; // 1-indexed for Sheets
      break;
    }
  }

  if (targetRow === -1) return { error: 'Staff ID not found: ' + staffId, found: false };

  // Check if already set
  var currentValue = String(sheet.getRange(targetRow, colIdx + 1).getValue()).trim();
  if (currentValue && currentValue !== '') {
    return {
      success: false,
      alreadySet: true,
      message: field + ' already recorded for ' + staffId + ' (' + currentValue + ')',
      value: currentValue
    };
  }

  // Write the value
  sheet.getRange(targetRow, colIdx + 1).setValue(value);

  // Update timestamp column
  var timestampCol = headers.indexOf('Timestamp') + 1;
  var deviceCol = headers.indexOf('Device') + 1;
  if (timestampCol > 0) sheet.getRange(targetRow, timestampCol).setValue(new Date());
  if (deviceCol > 0) sheet.getRange(targetRow, deviceCol).setValue(device);

  // Get the name for audit log
  var nameCol = headers.indexOf('Candidate Name');
  var name = nameCol >= 0 ? String(data[targetRow - 1][nameCol]) : staffId;

  // Log to audit
  logToAudit(field.toUpperCase(), device, name, field + ': ' + value);

  return {
    success: true,
    staffId: staffId,
    name: name,
    field: field,
    value: value
  };
}

// ── POST: Add new learner on-the-fly ──

function addLearner(params) {
  var sn = String(params.sn || '').trim();
  var name = String(params.name || '').trim();
  var staffId = String(params.staffId || '').trim();
  var indexNumber = String(params.indexNumber || '').trim();
  var group = String(params.group || '').trim();

  if (!name || !staffId) return { error: 'name and staffId are required' };

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Learners');
  if (!sheet) return { error: 'Learners sheet not found' };

  // Check duplicate
  var data = sheet.getDataRange().getValues();
  var headers = data[0].map(function(h) { return String(h).trim(); });
  var staffIdCol = headers.indexOf('Staff ID');
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][staffIdCol]).trim() === staffId) {
      return { error: 'Staff ID already exists', duplicate: true };
    }
  }

  // Append new row
  var row = new Array(headers.length).fill('');
  var snCol = headers.indexOf('S/N');
  var nameCol = headers.indexOf('Candidate Name');
  var idxCol = headers.indexOf('Index Number');
  var groupCol = headers.indexOf('Group');
  if (snCol >= 0) row[snCol] = sn;
  if (nameCol >= 0) row[nameCol] = name;
  if (staffIdCol >= 0) row[staffIdCol] = staffId;
  if (idxCol >= 0) row[idxCol] = indexNumber;
  if (groupCol >= 0) row[groupCol] = group;

  sheet.appendRow(row);

  logToAudit('ADD-LEARNER', 'APP', name, 'Added on-the-fly: ' + staffId);

  return { success: true, message: name + ' added', staffId: staffId };
}

// ── POST: Check duplicate ──

function checkDuplicate(params) {
  var staffId = String(params.staffId || '').trim();
  var field = String(params.field || '').trim();

  if (!staffId || !field) return { error: 'staffId and field are required' };

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Learners');
  if (!sheet) return { error: 'Learners sheet not found' };

  var data = sheet.getDataRange().getValues();
  var headers = data[0].map(function(h) { return String(h).trim(); });

  var sheetField = sheetFieldName(field);
  var colIdx = headers.indexOf(sheetField);
  var staffIdCol = headers.indexOf('Staff ID');

  if (colIdx === -1) return { error: 'Field not found: ' + field };

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][staffIdCol]).trim() === staffId) {
      var val = String(data[i][colIdx]).trim();
      return { exists: val !== '', value: val };
    }
  }

  return { exists: false, value: '' };
}

// ── POST: Supervisor approval ──

function approve(params) {
  var name = String(params.name || '').trim();
  if (!name) return { error: 'Supervisor name is required' };

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Config');
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
  var headers = [['S/N', 'Index Number', 'Candidate Name', 'Staff ID', 'Group', 'Time In', 'Module1', 'Module2', 'Module3', 'Breakfast', 'Lunch', 'Device', 'Timestamp']];
  learners.getRange(1, 1, 1, 13).setValues(headers);
  learners.getRange(1, 1, 1, 13).setFontWeight('bold').setBackground('#0265B1').setFontColor('white');
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
  var attExportHeaders = [['S/N', 'Index Number', 'Candidate Name', 'Staff ID', 'Time In', 'Module 1', 'Module 2', 'Module 3']];
  expAtt.getRange(3, 1, 1, 8).setValues(attExportHeaders);
  expAtt.getRange(3, 1, 1, 8).setFontWeight('bold').setBackground('#0265B1').setFontColor('white');
  // Pull data from Learners
  for (var r = 0; r < 600; r++) {
    var row = r + 4;
    expAtt.getRange(row, 1).setValue('=IF(Learners!A' + (r + 2) + '="","",Learners!A' + (r + 2) + ')');
    expAtt.getRange(row, 2).setValue('=IF(Learners!B' + (r + 2) + '="","",Learners!B' + (r + 2) + ')');
    expAtt.getRange(row, 3).setValue('=IF(Learners!C' + (r + 2) + '="","",Learners!C' + (r + 2) + ')');
    expAtt.getRange(row, 4).setValue('=IF(Learners!D' + (r + 2) + '="","",Learners!D' + (r + 2) + ')');
    expAtt.getRange(row, 5).setValue('=IF(Learners!F' + (r + 2) + '="","",Learners!F' + (r + 2) + ')');
    expAtt.getRange(row, 6).setValue('=IF(Learners!G' + (r + 2) + '="","",Learners!G' + (r + 2) + ')');
    expAtt.getRange(row, 7).setValue('=IF(Learners!H' + (r + 2) + '="","",Learners!H' + (r + 2) + ')');
    expAtt.getRange(row, 8).setValue('=IF(Learners!I' + (r + 2) + '="","",Learners!I' + (r + 2) + ')');
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
    expMeals.getRange(row2, 4).setValue('=IF(Learners!J' + (r2 + 2) + '="","",Learners!J' + (r2 + 2) + ')');
    expMeals.getRange(row2, 5).setValue('=IF(Learners!K' + (r2 + 2) + '="","",Learners!K' + (r2 + 2) + ')');
  }

  return { success: true, message: 'All tabs created with headers and formulas' };
}

// ── Audit Log Helper ──

function logToAudit(action, device, name, detail) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var audit = ss.getSheetByName('Audit Log');
  if (!audit) return;

  var supervisor = '';
  try {
    var config = ss.getSheetByName('Config');
    if (config) supervisor = String(config.getRange('B6').getValue() || '');
  } catch (e) {}

  audit.appendRow([new Date(), device, action, '', name, detail, supervisor]);
}

// ── Menu (runs when sheet opens) ──

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Tax Academy')
    .item('Initialize Sheet', 'initSheet')
    .item('Export Attendance CSV', 'exportAttendanceCSV')
    .item('Export Meals CSV', 'exportMealsCSV')
    .item('Approve & Lock', 'approveAndLockUI')
    .addToUi();
}

// ── UI: Approve & Lock ──

function approveAndLockUI() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var config = ss.getSheetByName('Config');
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

// ── Helper: Check if row timestamp is within date range ──

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

// ── UI: Export Attendance CSV ──

function exportAttendanceCSV() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var config = ss.getSheetByName('Config');
  var learners = ss.getSheetByName('Learners');
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
  var csv = 'S/N,Index Number,Candidate Name,Staff ID,Time In,' + m1 + ',' + m2 + ',' + m3 + '\n';
  for (var i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    if (!isWithinDateRange(data[i][12], startDate, endDate)) continue;
    csv += data[i][0] + ',"' + data[i][1] + '","' + data[i][2] + '","' + data[i][3] + '","' + (data[i][5] || '') + '","' + (data[i][6] || '') + '","' + (data[i][7] || '') + '","' + (data[i][8] || '') + '"\n';
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

// ── UI: Export Meals CSV ──

function exportMealsCSV() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var config = ss.getSheetByName('Config');
  var learners = ss.getSheetByName('Learners');
  var approved = config.getRange('B7').getValue();
  if (!approved) { SpreadsheetApp.getUi().alert('Supervisor must approve first.'); return; }

  var date = config.getRange('B1').getValue();
  var session = config.getRange('B2').getValue();
  var supervisor = config.getRange('B8').getValue();
  var startDate = config.getRange('B9').getValue();
  var endDate = config.getRange('B10').getValue();
  var dateStr = Utilities.formatDate(date, Session.getScriptTimeZone(), 'EEEE, d MMMM yyyy');

  var data = learners.getDataRange().getValues();
  var csv = 'S/N,Candidate Name,Staff ID,Breakfast,Lunch\n';
  for (var i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    if (!isWithinDateRange(data[i][12], startDate, endDate)) continue;
    csv += data[i][0] + ',"' + data[i][2] + '","' + data[i][3] + '","' + (data[i][9] || '') + '","' + (data[i][10] || '') + '"\n';
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

// ── Helper: Export folder ──

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
