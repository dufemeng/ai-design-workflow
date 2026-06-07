// T12 可证伪验证：liveMetrics 聚合；live 不是第一道入口（无 gap 报告则挡）；workbench 列问题。
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FlowLedgerStore } from '../dist/flow/index.js';
import { liveMetrics, generateLiveWorkbench, LiveError } from '../dist/live/index.js';
import { DEFAULT_CONFIG } from '../dist/config/index.js';

// 1) liveMetrics（纯）
const history = [
  { source: 'auto-fix', purpose: 'x', scope: 'token', relatedRule: null, needsReverify: false, at: 't', durationMs: null, result: null },
  { source: 'live', purpose: 'a', scope: 's', relatedRule: null, needsReverify: true, at: 't', durationMs: 1000, result: 'accepted' },
  { source: 'live', purpose: 'b', scope: 's', relatedRule: null, needsReverify: false, at: 't', durationMs: 2000, result: 'rejected' },
  { source: 'live', purpose: 'c', scope: 's', relatedRule: null, needsReverify: true, at: 't', durationMs: null, result: 'abandoned' },
];
const m = liveMetrics(history);
assert.equal(m.count, 3, '只数 live');
assert.equal(m.accepted, 1);
assert.equal(m.rejected, 1);
assert.equal(m.abandoned, 1);
assert.equal(m.needReverify, 2);
assert.equal(m.avgDurationMs, 1500);
assert.ok(Math.abs(m.reworkRate - 2 / 3) < 1e-9);

// 驱动一条 flow 到 code 阶段
const target = mkdtempSync(join(tmpdir(), 'adw-live-'));
mkdirSync(join(target, 'docs'), { recursive: true });
for (const f of ['proposal-x.html', 'design-x.md', 'design-x.html']) writeFileSync(join(target, 'docs', f), '<html>');
const store = new FlowLedgerStore(target, 'docs');
store.create({ slug: 'x', title: 'X' });
store.apply('x', { type: 'attachPrototype', htmlPath: 'docs/proposal-x.html', label: 'p' });
store.apply('x', { type: 'approvePrototype', selection: 'A' });
store.apply('x', { type: 'attachDesignArtifact', designMd: 'docs/design-x.md', designHtml: 'docs/design-x.html', designVersion: 'v1' });
store.apply('x', { type: 'runDesignReview', passed: true, blockingReasons: [] });
store.apply('x', { type: 'approveDesign' });
store.apply('x', { type: 'attachImplementationTarget', route: '/x', needsAuthedSession: true });

// 2) 没有 gap 报告 → live 被挡（不是第一道调试入口）
assert.throws(() => generateLiveWorkbench(target, DEFAULT_CONFIG, 'x'), LiveError, '无 gap 报告应抛 LiveError');

// 3) 有 gap 报告 → workbench 列出 toLive 阻塞 + 提醒
const reportRel = join('docs', 'assets', 'x', 'gap-report-0.json');
mkdirSync(join(target, 'docs', 'assets', 'x'), { recursive: true });
const report = {
  schemaVersion: 1, slug: 'x', url: 'u', viewport: { name: 'm', width: 393, height: 852 }, designVersion: 'v1', at: 't',
  captureStatus: 'ok',
  checks: [
    { check: 'state', status: 'block', findings: ['未覆盖 error 状态'] },
    { check: 'a11y', status: 'advisory', findings: ['缺 lang'] },
  ],
  blockingCount: 1, warningCount: 1, screenshotPath: null, note: '',
};
writeFileSync(join(target, reportRel), JSON.stringify(report));
store.apply('x', { type: 'attachGapReport', reportRef: reportRel, blockingCount: 1, warningCount: 1 });

const wb = generateLiveWorkbench(target, DEFAULT_CONFIG, 'x');
assert.equal(wb.problemCount, 2, 'toLive(state) + advisory(a11y) = 2');
assert.ok(existsSync(wb.path));
const html = readFileSync(wb.path, 'utf8');
assert.ok(html.includes('未覆盖 error 状态') && html.includes('缺 lang'), '问题应列在 workbench');
assert.ok(html.includes('Impeccable /live'), '应提示真正改页面由 agent 执行 Impeccable /live');

console.log('LIVE T12 VERIFY: ALL PASS  metrics + gate + workbench');
