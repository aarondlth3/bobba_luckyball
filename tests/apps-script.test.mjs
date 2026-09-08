import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

class Range {
  constructor(sheet, row, column, rows, columns) {
    this.sheet = sheet;
    this.row = row;
    this.column = column;
    this.rows = rows;
    this.columns = columns;
  }
  getValues() {
    return Array.from({ length: this.rows }, (_, r) =>
      Array.from({ length: this.columns }, (_, c) => this.sheet.get(this.row + r, this.column + c))
    );
  }
  setValues(values) {
    values.forEach((row, r) => row.forEach((value, c) => this.sheet.set(this.row + r, this.column + c, value)));
    return this;
  }
  setValue(value) {
    this.sheet.set(this.row, this.column, value);
    return this;
  }
}

class Sheet {
  constructor(name) {
    this.name = name;
    this.data = [];
  }
  get(row, column) {
    return this.data[row - 1]?.[column - 1] ?? '';
  }
  set(row, column, value) {
    while (this.data.length < row) this.data.push([]);
    while (this.data[row - 1].length < column) this.data[row - 1].push('');
    this.data[row - 1][column - 1] = value;
  }
  getRange(row, column, rows = 1, columns = 1) {
    return new Range(this, row, column, rows, columns);
  }
  getLastRow() {
    for (let row = this.data.length; row > 0; row -= 1) {
      if (this.data[row - 1].some(value => value !== '')) return row;
    }
    return 0;
  }
  appendRow(values) {
    this.data.push([...values]);
  }
  setFrozenRows() {}
}

class Spreadsheet {
  constructor() {
    this.id = 'spreadsheet-test-id';
    this.sheets = new Map();
  }
  getId() { return this.id; }
  getSheetByName(name) { return this.sheets.get(name) || null; }
  insertSheet(name) {
    const sheet = new Sheet(name);
    this.sheets.set(name, sheet);
    return sheet;
  }
}

const spreadsheet = new Spreadsheet();
const properties = new Map();
let uuid = 0;
const context = {
  console,
  Date,
  JSON,
  Math: Object.create(Math),
  Number,
  Object,
  String,
  Error,
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: key => properties.get(key) ?? null,
      setProperty: (key, value) => properties.set(key, value)
    })
  },
  SpreadsheetApp: {
    getActiveSpreadsheet: () => spreadsheet,
    openById: id => {
      assert.equal(id, spreadsheet.id);
      return spreadsheet;
    }
  },
  LockService: {
    getScriptLock: () => ({ waitLock() {}, releaseLock() {} })
  },
  Utilities: {
    getUuid: () => `uuid-${++uuid}`
  },
  HtmlService: {
    XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' },
    createHtmlOutput: content => ({
      content,
      setXFrameOptionsMode() { return this; }
    })
  }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8'), context);

context.setup();
const phraseSheet = spreadsheet.getSheetByName('Phrases');
const seed = ['A', 'B', 'C'].map((text, index) => [
  `id-${index + 1}`, text, true, 'available', new Date(), '', ''
]);
phraseSheet.getRange(2, 1, seed.length, 7).setValues(seed);

assert.deepEqual(
  JSON.parse(JSON.stringify(context.getState_().stats)),
  { available: 3, used: 0, total: 3 }
);

const roundOne = [
  context.drawPhrase_().phrase.text,
  context.drawPhrase_().phrase.text,
  context.drawPhrase_().phrase.text
];
assert.equal(new Set(roundOne).size, 3);
assert.deepEqual(
  JSON.parse(JSON.stringify(context.getState_().stats)),
  { available: 0, used: 3, total: 3 }
);

const last = roundOne.at(-1);
const next = context.drawPhrase_();
assert.equal(next.newRound, true);
assert.equal(next.round, 2);
assert.notEqual(next.phrase.text, last);

const beforeAdd = next.stats.available;
const added = context.addPhrase_('  Nueva   frase  ');
assert.equal(added.stats.available, beforeAdd + 1);
assert.throws(() => context.addPhrase_('nueva frase'), /Esa frase ya está/);

const reset = context.resetRound_();
assert.deepEqual(
  JSON.parse(JSON.stringify(reset.stats)),
  { available: 4, used: 0, total: 4 }
);
assert.equal(spreadsheet.getSheetByName('History').getLastRow(), 5);

const post = context.doPost({
  parameter: {
    payload: JSON.stringify({
      action: 'state',
      requestId: 'request-1',
      origin: 'https://aarondlth3.github.io'
    })
  }
});
assert.match(post.content, /request-1/);
assert.match(post.content, /"ok":true/);

console.log('Apps Script backend: 11 assertions passed');
