import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../../../.github/workflows/dsh-remote-windows.yml', import.meta.url), 'utf8');
const jobs = Object.fromEntries(source.split('\njobs:\n')[1].split(/(?=^  [a-z_]+:\s*$)/m).filter(Boolean).map((block) => {
  const [, name] = /^  ([a-z_]+):/m.exec(block);
  return [name, block];
}));
function condition(job) {
  const match = /^    if: >-\n((?:      .+\n)+)/m.exec(jobs[job]);
  assert.ok(match, `Missing job condition: ${job}`);
  return match[1].trim();
}
function eligible(job, { mode = 'azure', ref = 'refs/heads/main', event = 'push', build = 'success', azure = 'success', store = 'skipped', cancelled = false } = {}) {
  return runInNewContext(`(${condition(job)})`, {
    github: { ref, event_name: event },
    needs: { build: { result: build, outputs: { mode } }, sign_azure: { result: azure }, sign_store: { result: store } },
    always: () => true,
    cancelled: () => cancelled,
  }, { timeout: 100 });
}

test('PR builds remain hosted and read-only; signing requires the protected main environment', () => {
  assert.match(source, /^permissions:\n  contents: read\n/m);
  assert.match(jobs.build, /^    runs-on: windows-2022$/m);
  assert.doesNotMatch(jobs.build, /id-token:|secrets\.|environment:|self-hosted/);
  assert.match(jobs.build, /GITHUB_EVENT_NAME -eq 'pull_request'\) \{ 'none' \}/);
  assert.match(jobs.sign_store, /^    runs-on: \[self-hosted, windows, x64, remote-windows-signing\]$/m);
  assert.doesNotMatch(jobs.sign_store, /id-token:/);
  assert.match(jobs.sign_azure, /^      id-token: write$/m);
  for (const job of ['sign_azure', 'sign_store']) {
    assert.match(jobs[job], /^    environment: remote-windows-signing$/m);
    for (const mode of ['azure', 'certificate-store']) {
      assert.equal(eligible(job, { mode, event: 'pull_request' }), false);
      assert.equal(eligible(job, { mode, ref: 'refs/heads/feature', event: 'workflow_dispatch' }), false);
      assert.equal(eligible(job, { mode, ref: 'refs/tags/v1', event: 'workflow_dispatch' }), false);
    }
  }
  assert.equal(eligible('sign_azure', { mode: 'azure' }), true);
  assert.equal(eligible('sign_azure', { mode: 'certificate-store' }), false);
  assert.equal(eligible('sign_store', { mode: 'certificate-store' }), true);
  assert.equal(eligible('sign_store', { mode: 'azure' }), false);
});

test('publication requires exactly the successful artifact for the selected mode', () => {
  for (const mode of ['none', 'azure', 'certificate-store', 'invalid']) {
    for (const azure of ['success', 'failure', 'cancelled', 'skipped']) {
      for (const store of ['success', 'failure', 'cancelled', 'skipped']) {
        const expected = (mode === 'none' && azure === 'skipped' && store === 'skipped')
          || (mode === 'azure' && azure === 'success' && store === 'skipped')
          || (mode === 'certificate-store' && store === 'success' && azure === 'skipped');
        assert.equal(eligible('publish', { mode, azure, store }), expected, JSON.stringify({ mode, azure, store }));
        assert.equal(eligible('publish', { mode, azure, store, build: 'failure' }), false);
        assert.equal(eligible('publish', { mode, azure, store, event: 'pull_request' }), false);
        assert.equal(eligible('publish', { mode, azure, store, ref: 'refs/heads/feature' }), false);
        assert.equal(eligible('publish', { mode, azure, store, cancelled: true }), false);
      }
    }
  }
  assert.match(jobs.publish, /name: dsh-remote-windows-x64-\$\{\{ needs\.build\.outputs\.mode \}\}/);
  assert.match(jobs.publish, /record\['Mode'\] == mode/);
  assert.match(jobs.publish, /record\['ZipSHA256'\] == hashlib\.sha256/);
  assert.match(jobs.publish, /SmartScreen/);
});

test('Azure uses pinned actions and only the exact application file list', () => {
  assert.match(jobs.sign_azure, /uses: azure\/login@[a-f0-9]{40}\n/);
  assert.match(jobs.sign_azure, /uses: azure\/artifact-signing-action@[a-f0-9]{40}\n/);
  assert.match(jobs.sign_azure, /exclude-environment-credential: true/);
  assert.match(jobs.sign_azure, /exclude-azure-cli-credential: false/);
  assert.match(jobs.sign_azure, /cache-dependencies: false/);
  assert.doesNotMatch(jobs.sign_azure, /client-secret:|azure-password:|files-folder|continue-on-error/);
  const files = /          files: \|\n((?:            .+\n)+)/.exec(jobs.sign_azure)[1].trim().split('\n').map((line) => line.trim());
  assert.deepEqual(files, ['DSH Remote.exe', 'DSH Remote.dll', 'DshRemote.Core.dll'].map((name) => '${{ steps.prepare.outputs.package }}/' + name));
  for (const [job, mode] of [['sign_azure', 'azure'], ['sign_store', 'certificate-store']]) {
    assert.match(jobs[job], new RegExp(`pack\\.ps1 .+ -SigningMode ${mode}`));
    assert.doesNotMatch(jobs[job], /continue-on-error:|SigningMode none/);
  }
});
