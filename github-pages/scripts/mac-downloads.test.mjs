import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pickMacDownloads } from '../src/hooks/macDownloads.ts';

const asset = (name) => ({ name, browser_download_url: `https://example.test/${name}` });
test('separate Apple Silicon and default x64 release assets', () => {
  const arm = asset('Agent.Pulse-1.4.0-arm64.dmg');
  const intel = asset('Agent.Pulse-1.4.0.dmg');
  assert.deepEqual(pickMacDownloads([arm, intel]), { appleSilicon: arm.browser_download_url, intel: intel.browser_download_url });
});
test('explicit x64 and universal assets', () => {
  const intel = asset('Agent.Pulse-1.4.0-x64.dmg');
  const universal = asset('Agent.Pulse-1.4.0-universal.dmg');
  assert.deepEqual(pickMacDownloads([intel]), { appleSilicon: null, intel: intel.browser_download_url });
  assert.deepEqual(pickMacDownloads([intel, universal]), { appleSilicon: universal.browser_download_url, intel: universal.browser_download_url });
});
test('missing or unknown architecture never selects a wrong installer', () => {
  const arm = asset('Agent.Pulse-1.4.0-arm64.dmg');
  assert.deepEqual(pickMacDownloads([arm]), { appleSilicon: arm.browser_download_url, intel: null });
  for (const assets of [[], [asset('unknown.dmg')], [asset('Agent.Pulse-1.4.0-arm64.dmg.blockmap')]]) {
    assert.deepEqual(pickMacDownloads(assets), { appleSilicon: null, intel: null });
  }
});
