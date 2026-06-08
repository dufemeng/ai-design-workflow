// T15 可证伪验证：状态 / 交互 driver 必须真实驱动浏览器页面，并聚合进 gap check。
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG } from '../dist/config/index.js';
import { DesignFlowSpecSchema } from '../dist/design-flow/index.js';
import { analyzeSnapshot, capturePage, runRuntimeDrivers } from '../dist/gap/index.js';

const target = mkdtempSync(join(tmpdir(), 'adw-runtime-'));
const page = join(target, 'runtime.html');
writeFileSync(page, `<!doctype html>
<html lang="zh"><head><title>Runtime Driver</title></head>
<body>
  <h1>Runtime Driver</h1>
  <p id="state"></p>
  <button id="open">打开</button>
  <script>
    const params = new URL(location.href).searchParams;
    const state = params.get('state') || 'normal';
    document.getElementById('state').textContent = state.toUpperCase();
    document.getElementById('open').addEventListener('click', () => {
      const panel = document.createElement('section');
      panel.id = 'panel';
      panel.textContent = 'OPEN';
      document.body.appendChild(panel);
    });
    window.__ADW_STATE_DRIVERS__ = {
      makeError() {
        document.getElementById('state').textContent = 'ERROR';
      }
    };
  </script>
</body></html>`);

const spec = DesignFlowSpecSchema.parse({
  flow: 'runtime',
  title: 'Runtime',
  designVersion: 'sha256:runtime',
  screens: [{ id: 'home', name: '首页' }],
  states: [
    { id: 'empty', screenId: 'home', kind: 'empty', driver: { type: 'query-param', params: { state: 'empty' } }, expected: { text: 'EMPTY', urlIncludes: 'state=empty' } },
    { id: 'error', screenId: 'home', kind: 'error', driver: { type: 'test-hook', hook: 'makeError' }, expected: { text: 'ERROR' } },
    { id: 'boundary', screenId: 'home', kind: 'boundary', notTestableReason: '需要后端构造边界数据。' },
  ],
  interactions: [
    { id: 'open-panel', screenId: 'home', description: '打开面板', driver: { steps: [{ action: 'click', selector: '#open' }], expected: { text: 'OPEN', selector: '#panel' } } },
  ],
  targetRoute: '/runtime',
  acceptanceRules: [{ id: 'a1', rule: '状态与交互可驱动' }],
});

const viewport = { name: 'm', width: 393, height: 852 };
const url = `file://${page}`;
const runtime = await runRuntimeDrivers({
  targetDir: target,
  config: DEFAULT_CONFIG,
  slug: 'runtime',
  round: 0,
  url,
  viewport,
  spec,
});

assert.equal(runtime.states.find((s) => s.id === 'empty')?.status, 'pass');
assert.equal(runtime.states.find((s) => s.id === 'error')?.status, 'pass');
assert.equal(runtime.states.find((s) => s.id === 'boundary')?.status, 'not-testable');
assert.equal(runtime.interactions.find((s) => s.id === 'open-panel')?.status, 'pass');

const base = await capturePage(url, viewport);
const checks = analyzeSnapshot(base, spec, ['#ffffff'], DEFAULT_CONFIG.gap, { ok: true, source: 'impeccable-detect', command: 'test', findings: [] }, runtime);
const byCheck = Object.fromEntries(checks.map((r) => [r.check, r.status]));
assert.equal(byCheck.state, 'advisory', '部分状态 not-testable 时 state 应提醒而非伪装通过');
assert.equal(byCheck.interaction, 'pass', '有 driver 的交互应真实执行并通过');

console.log('RUNTIME DRIVER T15 VERIFY: ALL PASS  state=query/test-hook + interaction=click');
