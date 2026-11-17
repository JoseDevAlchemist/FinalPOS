import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const writes = [];
let finishWrite;
const events = {};
class FakeDisplay {
  events = events;
  addEventListener(name, listener) { this.events[name] = listener; }
  async connect() { this.events.connected(); }
  async disconnect() { this.events.disconnected(); }
  line(frame) {
    writes.push(frame);
    return new Promise(resolve => { finishWrite = resolve; });
  }
}
const source = await readFile(new URL('../../lib/customer-display.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const exports = {};
vm.runInNewContext(compiled, { exports, require: () => ({ default: FakeDisplay }), window: { isSecureContext: true }, navigator: { serial: {} } });
const tick = () => new Promise(resolve => setImmediate(resolve));
exports.paintCustomerDisplay(100);
exports.paintCustomerDisplay(200);
await exports.connectCustomerDisplay();
assert.equal(writes.length, 1);
assert.equal(writes[0][0], 'TOTAL: KES 200');
exports.paintCustomerDisplay(300);
exports.paintCustomerDisplay(400);
assert.equal(writes.length, 1, 'writes cannot overlap');
finishWrite(); await tick();
assert.equal(writes.length, 2);
assert.equal(writes[1][0], 'TOTAL: KES 400', 'intermediate pending total was dropped');
exports.clearCustomerDisplay(); finishWrite(); await tick();
assert.equal(writes[2][0], 'WELCOME TO PEDIGREE');
finishWrite(); await tick();
events.disconnected();
assert.equal(exports.getCustomerDisplayState().status, 'disconnected');
exports.paintCustomerDisplay(500);
assert.equal(writes.length, 3, 'disconnected hardware never blocks or writes');
await exports.connectCustomerDisplay();
assert.equal(writes[3][0], 'TOTAL: KES 500');
finishWrite(); await tick();
console.log('PASS: disconnected and in-flight latest-wins frames, serialized writes, welcome and reconnect. No physical hardware used.');
