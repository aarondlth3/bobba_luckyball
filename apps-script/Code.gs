const CONFIG = Object.freeze({
  FRONTEND_ORIGIN: 'https://aarondlth3.github.io',
  MAX_PHRASE_LENGTH: 220,
  LOCK_TIMEOUT_MS: 10000,
  SHEETS: Object.freeze({
    PHRASES: 'Phrases',
    HISTORY: 'History',
    META: 'Meta'
  }),
  PHRASE_HEADERS: Object.freeze([
    'id', 'text', 'active', 'status', 'created_at', 'last_drawn_at', 'last_drawn_round'
  ]),
  HISTORY_HEADERS: Object.freeze([
    'draw_id', 'phrase_id', 'phrase_text', 'round', 'drawn_at'
  ]),
  META_HEADERS: Object.freeze(['key', 'value'])
});

/**
 * Run once from the Apps Script editor while this project is bound to the
 * LuckyBall spreadsheet. It stores the spreadsheet ID and repairs headers.
 */
function setup() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) {
    throw new Error('Abre Apps Script desde la hoja de LuckyBall y vuelve a ejecutar setup().');
  }

  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', spreadsheet.getId());
  ensureStructure_(spreadsheet);
  return getState_();
}

function doGet() {
  return HtmlService.createHtmlOutput('LuckyBall API activa.');
}

function doPost(e) {
  let requestId = '';
  let origin = CONFIG.FRONTEND_ORIGIN;

  try {
    const request = parseRequest_(e);
    requestId = request.requestId || '';
    origin = validateOrigin_(request.origin);

    const lock = LockService.getScriptLock();
    lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
    try {
      const data = route_(request);
      return responsePage_({ ok: true, requestId: requestId, data: data }, origin);
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    return responsePage_({
      ok: false,
      requestId: requestId,
      error: {
        code: error.code || 'SERVER_ERROR',
        message: error.message || 'No se pudo completar la operación.'
      }
    }, origin);
  }
}

function route_(request) {
  switch (request.action) {
    case 'state': return getState_();
    case 'draw': return drawPhrase_();
    case 'add': return addPhrase_(request.text);
    case 'reset': return resetRound_();
    default: throw apiError_('BAD_ACTION', 'Operación no reconocida.');
  }
}

function getState_() {
  const spreadsheet = getSpreadsheet_();
  ensureStructure_(spreadsheet);
  const phrases = readPhrases_(spreadsheet);
  return {
    round: getRound_(spreadsheet),
    stats: stats_(phrases)
  };
}

function drawPhrase_() {
  const spreadsheet = getSpreadsheet_();
  ensureStructure_(spreadsheet);
  let phrases = readPhrases_(spreadsheet);
  const active = phrases.filter(function (phrase) { return phrase.active; });

  if (active.length === 0) {
    throw apiError_('NO_PHRASES', 'Agrega una frase antes de usar la bola.');
  }

  let round = getRound_(spreadsheet);
  let available = active.filter(function (phrase) { return phrase.status === 'available'; });
  let newRound = false;

  if (available.length === 0) {
    round += 1;
    setAllActiveAvailable_(spreadsheet, phrases);
    setMeta_(spreadsheet, 'current_round', String(round));
    phrases = readPhrases_(spreadsheet);
    available = phrases.filter(function (phrase) { return phrase.active && phrase.status === 'available'; });
    newRound = true;
  }

  const lastPhraseId = getMeta_(spreadsheet, 'last_phrase_id');
  let candidates = available;
  if (available.length > 1 && lastPhraseId) {
    candidates = available.filter(function (phrase) { return phrase.id !== lastPhraseId; });
  }

  const picked = candidates[Math.floor(Math.random() * candidates.length)];
  const now = new Date();
  const phraseSheet = spreadsheet.getSheetByName(CONFIG.SHEETS.PHRASES);
  phraseSheet.getRange(picked.row, 4, 1, 4).setValues([[
    'used', picked.createdAt, now, round
  ]]);

  spreadsheet.getSheetByName(CONFIG.SHEETS.HISTORY).appendRow([
    Utilities.getUuid(), picked.id, picked.text, round, now
  ]);

  setMeta_(spreadsheet, 'current_round', String(round));
  setMeta_(spreadsheet, 'last_phrase_id', picked.id);
  setMeta_(spreadsheet, 'updated_at', now.toISOString());

  phrases = readPhrases_(spreadsheet);
  return {
    phrase: { id: picked.id, text: picked.text },
    round: round,
    newRound: newRound,
    stats: stats_(phrases)
  };
}

function addPhrase_(rawText) {
  const text = normalizeText_(rawText);
  if (!text) throw apiError_('EMPTY_PHRASE', 'Escribe una frase primero.');
  if (text.length > CONFIG.MAX_PHRASE_LENGTH) {
    throw apiError_('PHRASE_TOO_LONG', 'La frase es demasiado larga.');
  }

  const spreadsheet = getSpreadsheet_();
  ensureStructure_(spreadsheet);
  const phrases = readPhrases_(spreadsheet);
  const duplicate = phrases.some(function (phrase) {
    return phrase.active && phrase.text.toLocaleLowerCase() === text.toLocaleLowerCase();
  });
  if (duplicate) throw apiError_('DUPLICATE_PHRASE', 'Esa frase ya está en el frasco.');

  const now = new Date();
  spreadsheet.getSheetByName(CONFIG.SHEETS.PHRASES).appendRow([
    Utilities.getUuid(), text, true, 'available', now, '', ''
  ]);
  setMeta_(spreadsheet, 'updated_at', now.toISOString());

  return {
    round: getRound_(spreadsheet),
    stats: stats_(readPhrases_(spreadsheet))
  };
}

function resetRound_() {
  const spreadsheet = getSpreadsheet_();
  ensureStructure_(spreadsheet);
  const phrases = readPhrases_(spreadsheet);
  const round = getRound_(spreadsheet) + 1;
  setAllActiveAvailable_(spreadsheet, phrases);
  setMeta_(spreadsheet, 'current_round', String(round));
  setMeta_(spreadsheet, 'last_phrase_id', '');
  setMeta_(spreadsheet, 'updated_at', new Date().toISOString());
  return { round: round, stats: stats_(readPhrases_(spreadsheet)) };
}

function parseRequest_(e) {
  if (!e || !e.parameter || !e.parameter.payload) {
    throw apiError_('BAD_REQUEST', 'La solicitud está incompleta.');
  }
  try {
    return JSON.parse(e.parameter.payload);
  } catch (error) {
    throw apiError_('BAD_JSON', 'La solicitud no contiene JSON válido.');
  }
}

function validateOrigin_(origin) {
  if (origin !== CONFIG.FRONTEND_ORIGIN) {
    throw apiError_('BAD_ORIGIN', 'Origen no autorizado.');
  }
  return origin;
}

function responsePage_(payload, targetOrigin) {
  const safePayload = JSON.stringify(payload)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  const safeOrigin = JSON.stringify(targetOrigin);
  const html = '<!doctype html><meta charset="utf-8"><script>' +
    'window.top.postMessage(' + safePayload + ',' + safeOrigin + ');' +
    '</script>';
  return HtmlService.createHtmlOutput(html)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw apiError_('NOT_CONFIGURED', 'Ejecuta setup() una vez antes de desplegar la API.');
  return SpreadsheetApp.openById(id);
}

function ensureStructure_(spreadsheet) {
  ensureSheet_(spreadsheet, CONFIG.SHEETS.PHRASES, CONFIG.PHRASE_HEADERS);
  ensureSheet_(spreadsheet, CONFIG.SHEETS.HISTORY, CONFIG.HISTORY_HEADERS);
  ensureSheet_(spreadsheet, CONFIG.SHEETS.META, CONFIG.META_HEADERS);

  if (!getMeta_(spreadsheet, 'schema_version')) setMeta_(spreadsheet, 'schema_version', '1');
  if (!getMeta_(spreadsheet, 'current_round')) setMeta_(spreadsheet, 'current_round', '1');
  if (getMeta_(spreadsheet, 'last_phrase_id') === null) setMeta_(spreadsheet, 'last_phrase_id', '');
  if (!getMeta_(spreadsheet, 'updated_at')) setMeta_(spreadsheet, 'updated_at', new Date().toISOString());
}

function ensureSheet_(spreadsheet, name, headers) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);
  const existing = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const valid = headers.every(function (header, index) { return existing[index] === header; });
  if (!valid) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  return sheet;
}

function readPhrases_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName(CONFIG.SHEETS.PHRASES);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, CONFIG.PHRASE_HEADERS.length).getValues()
    .filter(function (row) { return row[0] && row[1]; })
    .map(function (row, index) {
      return {
        row: index + 2,
        id: String(row[0]),
        text: String(row[1]),
        active: row[2] === true || String(row[2]).toLowerCase() === 'true',
        status: String(row[3] || 'available'),
        createdAt: row[4],
        lastDrawnAt: row[5],
        lastDrawnRound: row[6]
      };
    });
}

function stats_(phrases) {
  const active = phrases.filter(function (phrase) { return phrase.active; });
  const available = active.filter(function (phrase) { return phrase.status === 'available'; }).length;
  return { available: available, used: active.length - available, total: active.length };
}

function setAllActiveAvailable_(spreadsheet, phrases) {
  const sheet = spreadsheet.getSheetByName(CONFIG.SHEETS.PHRASES);
  phrases.forEach(function (phrase) {
    if (phrase.active) sheet.getRange(phrase.row, 4).setValue('available');
  });
}

function getRound_(spreadsheet) {
  const value = Number(getMeta_(spreadsheet, 'current_round'));
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

function getMeta_(spreadsheet, key) {
  const sheet = spreadsheet.getSheetByName(CONFIG.SHEETS.META);
  if (!sheet || sheet.getLastRow() < 2) return null;
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  for (let i = 0; i < rows.length; i += 1) {
    if (rows[i][0] === key) return String(rows[i][1]);
  }
  return null;
}

function setMeta_(spreadsheet, key, value) {
  const sheet = spreadsheet.getSheetByName(CONFIG.SHEETS.META);
  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    const keys = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < keys.length; i += 1) {
      if (keys[i][0] === key) {
        sheet.getRange(i + 2, 2).setValue(value);
        return;
      }
    }
  }
  sheet.appendRow([key, value]);
}

function normalizeText_(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function apiError_(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
