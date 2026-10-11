import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';

// Only Apple tools and compilation are stubbed; every case executes the shipping shell scripts.
const toolStub = String.raw`#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const tool = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const env = process.env;
const state = env.SIGNING_TEST_ROOT;
const last = args.at(-1);
const secrets = [env.REMOTE_MAC_CERTIFICATE_PASSWORD, env.REMOTE_MAC_APP_SPECIFIC_PASSWORD, env.REMOTE_MAC_APPLE_ID].filter(Boolean);
const safe = args.map((value, index) => ['-p', '-P', '-k', '--password', '--apple-id'].includes(args[index - 1]) && !(args[index - 1] === '-k' && tool === 'ditto') ? '<private>' : value);
const event = { tool, args: safe };
let stage = tool;
if (tool === 'security') stage += ' ' + args[0];
if (tool === 'codesign') stage += args.includes('--display') ? ' display' : args.includes('--verify') ? ' verify' : ' sign';
if (tool === 'xcrun') stage = args.slice(0, 2).join(' ');
if (tool === 'security' && args[0] === 'list-keychains' && args.includes('-s')) stage += ' restore';
if (tool === 'security' && args[0] === 'import') {
  event.directoryMode = fs.statSync(path.dirname(args[1])).mode & 0o777;
  event.certificateMode = fs.statSync(args[1]).mode & 0o777;
  event.certificate = fs.readFileSync(args[1], 'utf8');
}
fs.appendFileSync(path.join(state, 'events'), JSON.stringify({ ...event, stage }) + '\n');
if (stage === env.SIGNING_TEST_SIGNAL) {
  process.kill(process.ppid, 'SIGTERM');
  process.exit(0);
}
if (stage === env.SIGNING_TEST_FAIL) {
  console.error('tool echoed credentials: ' + secrets.join(' '));
  process.exit(1);
}
if (tool === 'security') {
  const command = args[0];
  if (command === 'list-keychains') {
    if (args.includes('-s')) fs.writeFileSync(path.join(state, 'search-list'), JSON.stringify(args.slice(args.indexOf('-s') + 1)));
    else if (!env.SIGNING_TEST_EMPTY_KEYCHAINS) console.log('    "/Users/test/Library/Keychains/login.keychain-db"\n    "/Library/Keychains/System.keychain"');
  }
  if (command === 'create-keychain') fs.writeFileSync(last, 'private keychain');
  if (command === 'delete-keychain') fs.unlinkSync(last);
} else if (tool === 'codesign' && args.includes('--display')) {
  console.error('Authority=' + (env.SIGNING_TEST_IDENTITY || env.REMOTE_MAC_SIGNING_IDENTITY));
  console.error('TeamIdentifier=' + (env.SIGNING_TEST_TEAM || env.REMOTE_MAC_TEAM_ID));
  if (!env.SIGNING_TEST_NO_RUNTIME) console.error('CodeDirectory v=20500 size=500 flags=0x10000(runtime) hashes=5+3 location=embedded');
  if (!env.SIGNING_TEST_NO_TIMESTAMP) console.error('Timestamp=Oct 11, 2026 at 10:00:00');
} else if (tool === 'xcrun') {
  if (args[0] === 'swiftc') fs.writeFileSync(args[args.indexOf('-o') + 1], 'compiled');
  if (args[0] === 'notarytool' && args[1] === 'submit') console.log(JSON.stringify({ status: env.SIGNING_TEST_NOTARY_STATUS || 'Accepted' }));
  if (args[0] === 'stapler' && args[1] === 'staple') fs.writeFileSync(path.join(last, 'ticket'), 'stapled');
  if (args[0] === 'stapler' && args[1] === 'validate') assertTicket(last);
} else if (tool === 'lipo') fs.writeFileSync(args[args.indexOf('-output') + 1], 'universal');
else if (tool === 'ditto') {
  const app = args.at(-2);
  const ticket = fs.existsSync(path.join(app, 'ticket'));
  fs.writeFileSync(last, ticket ? 'archive: stapled app' : 'archive: unstapled app');
} else if (tool === 'plutil') console.log(JSON.parse(fs.readFileSync(last, 'utf8')).status);
else if (tool === 'spctl') assertTicket(last);
function assertTicket(app) {
  if (!fs.existsSync(path.join(app, 'ticket'))) process.exit(2);
}
`;

async function fixture(t, overrides = {}) {
  const temporaryBase = await realpath(os.tmpdir());
  const root = await mkdtemp(path.join(temporaryBase, 'dsh-mac-signing-test-'));
  t.after(async () => {
    assert.equal(path.dirname(root), temporaryBase);
    assert.ok(path.basename(root).startsWith('dsh-mac-signing-test-'));
    await rm(root, { recursive: true, force: true });
  });
  const bin = path.join(root, 'bin');
  const mac = path.join(root, 'mac');
  const temporary = path.join(root, 'temporary');
  await Promise.all([mkdir(bin), mkdir(path.join(mac, 'Resources'), { recursive: true }), mkdir(temporary)]);
  await Promise.all(['build.sh', 'sign-release.sh', 'entitlements.plist'].map(name => copyFile(new URL('../' + name, import.meta.url), path.join(mac, name))));
  await writeFile(path.join(mac, 'Resources', 'AppIcon.icns'), 'icon');
  await writeFile(path.join(mac, 'Fixture.swift'), '// Compiler input');
  const stub = path.join(bin, 'stub.mjs');
  await writeFile(stub, toolStub);
  await chmod(stub, 0o755);
  await Promise.all(['security', 'codesign', 'xcrun', 'lipo', 'ditto', 'plutil', 'spctl'].map(tool => symlink(stub, path.join(bin, tool))));
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('REMOTE_MAC_') && !name.startsWith('SIGNING_TEST_')));
  const env = {
    ...inherited,
    PATH: bin + path.delimiter + process.env.PATH,
    TMPDIR: temporary,
    SIGNING_TEST_ROOT: root,
    REMOTE_MAC_SIGNING_MODE: 'developer-id',
    REMOTE_MAC_CERTIFICATE_P12_BASE64: Buffer.from('fixture certificate').toString('base64'),
    REMOTE_MAC_CERTIFICATE_PASSWORD: 'fixture-p12-private',
    REMOTE_MAC_SIGNING_IDENTITY: 'Developer ID Application: Fixture Org (ABCDE12345)',
    REMOTE_MAC_TEAM_ID: 'ABCDE12345',
    REMOTE_MAC_APPLE_ID: 'fixture-private@example.test',
    REMOTE_MAC_APP_SPECIFIC_PASSWORD: 'fixture-apple-private',
    UPDATE_REPO: 'fixture/repository',
    ...overrides,
  };
  return {
    root, mac, env,
    async run() {
      const result = await new Promise(resolve => {
        execFile('bash', [path.join(mac, 'build.sh'), '--no-install'], { cwd: root, env, timeout: 120_000 }, (error, stdout, stderr) => resolve({ error, stdout, stderr }));
      });
      assert.ok(!result.error?.killed, 'script must finish before its process deadline');
      assert.ok(!result.error?.signal, 'script must exit without a signal');
      for (const value of ['fixture-p12-private', 'fixture-apple-private', 'fixture-private@example.test', env.REMOTE_MAC_CERTIFICATE_P12_BASE64]) {
        if (value) assert.ok(!(result.stdout + result.stderr).includes(value), 'tool credentials must not appear in output');
      }
      assert.deepEqual(await readdir(temporary), [], 'private signing files and keychain must be cleaned');
      const events = await readFile(path.join(root, 'events'), 'utf8').catch(error => {
        if (error.code !== 'ENOENT') throw error;
        return '';
      });
      return { ...result, events: events.trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) };
    },
  };
}

async function assertRestored(f) {
  assert.deepEqual(JSON.parse(await readFile(path.join(f.root, 'search-list'), 'utf8')), [
    '/Users/test/Library/Keychains/login.keychain-db', '/Library/Keychains/System.keychain',
  ]);
}

async function assertNoArchive(f) {
  await assert.rejects(readFile(path.join(f.mac, 'build', 'DSH-Remote.zip')), { code: 'ENOENT' });
}

describe('Mac release signing', { concurrency: true }, () => {
  for (const mode of ['', 'adhoc']) {
    test(`mode ${JSON.stringify(mode)} keeps credential-free ad-hoc packaging`, async t => {
      const f = await fixture(t, { REMOTE_MAC_SIGNING_MODE: mode, REMOTE_MAC_CERTIFICATE_PASSWORD: '', REMOTE_MAC_APPLE_ID: '' });
      const result = await f.run();
      assert.equal(result.error, null, result.stderr);
      assert.deepEqual(result.events.filter(event => event.tool === 'codesign').map(event => event.args.slice(0, -1)), [['--force', '--deep', '-s', '-']]);
      assert.ok(!result.events.some(event => event.tool === 'security' || event.stage.startsWith('notarytool')));
      assert.equal(await readFile(path.join(f.mac, 'build', 'DSH-Remote.zip'), 'utf8'), 'archive: unstapled app');
    });
  }

  for (const name of ['REMOTE_MAC_CERTIFICATE_P12_BASE64', 'REMOTE_MAC_CERTIFICATE_PASSWORD', 'REMOTE_MAC_SIGNING_IDENTITY', 'REMOTE_MAC_TEAM_ID', 'REMOTE_MAC_APPLE_ID', 'REMOTE_MAC_APP_SPECIFIC_PASSWORD']) {
    test(`developer-id rejects missing ${name} before compiling`, async t => {
      const f = await fixture(t, { [name]: '' });
      const result = await f.run();
      assert.equal(result.error?.code, 1);
      assert.match(result.stderr, new RegExp(name));
      assert.deepEqual(result.events, []);
      await assertNoArchive(f);
    });
  }

  test('rejects an unknown signing mode instead of downgrading', async t => {
    const f = await fixture(t, { REMOTE_MAC_SIGNING_MODE: 'developer-idd' });
    const result = await f.run();
    assert.equal(result.error?.code, 1);
    assert.deepEqual(result.events, []);
    await assertNoArchive(f);
  });

  test('rejects an identity configured for another team', async t => {
    const f = await fixture(t, { REMOTE_MAC_TEAM_ID: 'OTHER12345' });
    const result = await f.run();
    assert.equal(result.error?.code, 1);
    assert.deepEqual(result.events, []);
    await assertNoArchive(f);
  });

  test('rejects malformed certificate data and removes its private directory', async t => {
    const f = await fixture(t, { REMOTE_MAC_CERTIFICATE_P12_BASE64: 'invalid!base64' });
    const result = await f.run();
    assert.equal(result.error?.code, 1);
    assert.match(result.stderr, /Decoding REMOTE_MAC_CERTIFICATE_P12_BASE64 failed/);
    assert.ok(!result.events.some(event => event.stage === 'security create-keychain'));
    await assertNoArchive(f);
  });

  test('signs with runtime and timestamp, notarizes, then packages the stapled app', async t => {
    const f = await fixture(t);
    const result = await f.run();
    assert.equal(result.error, null, result.stderr);
    const sign = result.events.find(event => event.stage === 'codesign sign');
    assert.ok(sign.args.includes('--timestamp'));
    const entitlements = await readFile(path.resolve(f.mac, sign.args[sign.args.indexOf('--entitlements') + 1]), 'utf8');
    assert.match(entitlements, /<key>com\.apple\.security\.device\.audio-input<\/key><true\/>/);
    const plist = await readFile(path.join(f.mac, 'build', 'DSH Remote.app', 'Contents', 'Info.plist'), 'utf8');
    assert.match(plist, /<key>CFBundleShortVersionString<\/key><string>1\.0\.\d+<\/string>/);
    assert.equal(sign.args[sign.args.indexOf('--options') + 1], 'runtime');
    assert.equal(sign.args[sign.args.indexOf('--sign') + 1], f.env.REMOTE_MAC_SIGNING_IDENTITY);
    const keychain = sign.args[sign.args.indexOf('--keychain') + 1];
    assert.ok(keychain.startsWith(path.join(f.root, 'temporary') + path.sep));
    const imported = result.events.find(event => event.stage === 'security import');
    assert.equal(imported.directoryMode, 0o700);
    assert.equal(imported.certificateMode, 0o600);
    assert.equal(imported.certificate, 'fixture certificate');
    const submit = result.events.find(event => event.stage === 'notarytool submit');
    assert.ok(submit.args.includes('--wait'));
    assert.equal(submit.args[submit.args.indexOf('--timeout') + 1], '30m');
    assert.equal(submit.args[submit.args.indexOf('--keychain') + 1], keychain);
    assert.ok(submit.args.includes('--keychain-profile'));
    assert.ok(!submit.args.includes('--password'));
    const stages = result.events.map(event => event.stage);
    assert.ok(stages.indexOf('stapler staple') < stages.indexOf('stapler validate'));
    assert.ok(stages.indexOf('stapler validate') < stages.indexOf('spctl'));
    assert.ok(stages.indexOf('spctl') < stages.lastIndexOf('ditto'));
    assert.equal(await readFile(path.join(f.mac, 'build', 'DSH-Remote.zip'), 'utf8'), 'archive: stapled app');
    await assertRestored(f);
  });

  for (const stage of ['security create-keychain', 'security unlock-keychain', 'security set-keychain-settings', 'security import', 'security set-key-partition-list', 'codesign sign', 'codesign verify', 'notarytool store-credentials', 'notarytool submit', 'stapler staple', 'stapler validate', 'spctl', 'security delete-keychain', 'security list-keychains restore']) {
    test(`${stage} failure blocks packaging and cleans private files`, async t => {
      const f = await fixture(t, { SIGNING_TEST_FAIL: stage });
      const result = await f.run();
      assert.equal(result.error?.code, 1);
      assert.ok(result.events.some(event => event.stage === 'security delete-keychain'));
      assert.ok(result.events.some(event => event.stage === 'security list-keychains restore'));
      if (stage !== 'security list-keychains restore') await assertRestored(f);
      await assertNoArchive(f);
    });
  }

  test('restores an initially empty keychain search list', async t => {
    const f = await fixture(t, { SIGNING_TEST_EMPTY_KEYCHAINS: '1' });
    const result = await f.run();
    assert.equal(result.error, null, result.stderr);
    assert.deepEqual(JSON.parse(await readFile(path.join(f.root, 'search-list'), 'utf8')), []);
  });

  test('termination during notarization restores keychain state and blocks packaging', async t => {
    const f = await fixture(t, { SIGNING_TEST_SIGNAL: 'notarytool submit' });
    const result = await f.run();
    assert.equal(result.error?.code, 143);
    await assertRestored(f);
    await assertNoArchive(f);
  });

  for (const [name, value, diagnostic] of [
    ['SIGNING_TEST_IDENTITY', 'Developer ID Application: Other Org (ABCDE12345)', /Signed app identity/],
    ['SIGNING_TEST_TEAM', 'OTHER12345', /Signed app team/],
    ['SIGNING_TEST_NO_RUNTIME', '1', /hardened runtime/],
    ['SIGNING_TEST_NO_TIMESTAMP', '1', /secure timestamp/],
    ['SIGNING_TEST_NOTARY_STATUS', 'Invalid', /not Accepted/],
    ['SIGNING_TEST_NOTARY_STATUS', 'In Progress', /not Accepted/],
  ]) {
    test(`rejects ${name}=${value} and restores keychain state`, async t => {
      const f = await fixture(t, { [name]: value });
      const result = await f.run();
      assert.equal(result.error?.code, 1);
      assert.match(result.stderr, diagnostic);
      await assertRestored(f);
      await assertNoArchive(f);
    });
  }
});
