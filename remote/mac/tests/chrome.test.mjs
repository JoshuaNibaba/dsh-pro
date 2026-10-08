import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const swift = fs.readFileSync(new URL('../Chrome.swift', import.meta.url), 'utf8');
const script = swift.match(/static let script = """\n([\s\S]*?)\n    """/)[1]
  .replace('\\(handlerName)', 'dshChrome');

function page() {
  const state = { color: '#151517', source: 'dark' };
  const messages = [];
  const events = {};
  let observer;
  let options;
  const context = {
    document: {
      documentElement: { getAttribute: () => state.source },
      body: {},
      querySelector: () => ({ content: state.color }),
      addEventListener: (event, callback) => { events[event] = callback; },
    },
    window: {
      webkit: { messageHandlers: { dshChrome: { postMessage: message => messages.push(message) } } },
      addEventListener: (event, callback) => { events[event] = callback; },
    },
    getComputedStyle: () => ({ backgroundColor: '#ffffff' }),
    MutationObserver: class {
      constructor(callback) { observer = callback; }
      observe(target, settings) { options = settings; }
    },
  };
  vm.runInNewContext(script, context);
  return { state, messages, events, mutate: () => observer(), options };
}

test('switching to system reports its source even when the background stays dark', () => {
  const p = page();
  p.events.DOMContentLoaded();
  assert.equal(p.messages.at(-1).source, 'dark');
  assert.ok(p.options.attributeFilter.includes('data-ds-theme-source'));
  p.state.source = 'system';
  p.mutate();
  assert.equal(p.messages.length, 2);
  assert.equal(p.messages.at(-1).source, 'system');
  assert.equal(p.messages.at(-1).color, '#151517');
  p.events.load();
  assert.equal(p.messages.length, 2);
});

test('system appearance updates the titlebar background after macOS changes scheme', () => {
  const p = page();
  p.state.source = 'system';
  p.events.DOMContentLoaded();
  p.state.color = '#ffffff';
  p.mutate();
  assert.equal(p.messages.length, 2);
  assert.equal(p.messages.at(-1).source, 'system');
  assert.equal(p.messages.at(-1).color, '#ffffff');
});

test('pages without theme metadata report the computed background', () => {
  const p = page();
  p.state.source = null;
  p.state.color = null;
  p.events.DOMContentLoaded();
  assert.equal(p.messages.at(-1).color, '#ffffff');
  assert.equal(p.messages.at(-1).source, null);
});
