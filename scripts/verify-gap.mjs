// T10 可证伪验证：纯分析层（token/dom/detector/a11y，state/interaction 诚实 not-run）
// + GapReport schema + 真·Chromium 采集 file:// 页面。
// 注：detector 现来自 impeccable detect adapter（analyzeSnapshot 第 5 参），不再从 domHtml 里找 slop。
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG } from '../dist/config/index.js';
import { DesignFlowSpecSchema } from '../dist/design-flow/index.js';
import { analyzeSnapshot, countSeverities, GapReportSchema, capturePage, GapCaptureError } from '../dist/gap/index.js';

const spec = DesignFlowSpecSchema.parse({ flow: 'x', title: 'X', designVersion: 'sha256:abc', screens: [{ id: 'home', name: '首页' }], states: [{ id: 'e', screenId: 'home', kind: 'empty' }] });
const gap = DEFAULT_CONFIG.gap;
const vp = { name: 'm', width: 393, height: 852 };
const palette = ['#faff69'];
const base = { url: 'x', viewport: vp, title: 'T', screenshotPath: null };

// detect adapter 结果桩：通过 / 阻塞性 finding / 不可用
const detPass = { ok: true, source: 'impeccable-detect', command: 'test', findings: [] };
const detBlock = { ok: true, source: 'impeccable-detect', command: 'test', findings: [{ antipattern: 'generic-copy', severity: 'error', snippet: 'Click here', file: null, line: null, description: null, name: null }] };
const detAdvisory = { ok: true, source: 'impeccable-detect', command: 'test', findings: [{ antipattern: 'nit', severity: 'advisory', snippet: 'x', file: null, line: null, description: null, name: null }] };
const detUnavailable = { ok: false, source: 'impeccable-detect', command: null, reason: 'unavailable', message: 'no impeccable cli', findings: [] };

const byCheck = (res) => Object.fromEntries(res.map((r) => [r.check, r.status]));

// 干净页 + detector pass：token pass、dom pass、detector pass、a11y pass、state/interaction not-run、0 阻塞
const clean = analyzeSnapshot({ ...base, domHtml: '<html lang="zh"><head><title>T</title></head><body><h1>标题</h1><p>足够长的内容文字</p></body></html>', usedColors: ['rgb(250,255,105)', 'rgb(10,10,10)', 'rgba(0,0,0,0)'] }, spec, palette, gap, detPass);
const cs = byCheck(clean);
assert.equal(cs.token, 'pass');
assert.equal(cs.dom, 'pass');
assert.equal(cs.detector, 'pass');
assert.equal(cs.state, 'not-run');
assert.equal(cs.interaction, 'not-run');
assert.equal(countSeverities(clean).blockingCount, 0);

// 颜色漂移 → token 阻塞
const drift = analyzeSnapshot({ ...base, domHtml: '<html lang="zh"><title>T</title><h1>x</h1>正文', usedColors: ['rgb(255,0,128)'] }, spec, palette, gap, detPass);
assert.equal(byCheck(drift).token, 'block');

// 灰阶/黑白不算漂移
const grayOnly = analyzeSnapshot({ ...base, domHtml: '<html lang="zh"><title>T</title><h1>x</h1>正文', usedColors: ['rgb(17,17,17)', 'rgb(245,245,245)'] }, spec, palette, gap, detPass);
assert.equal(byCheck(grayOnly).token, 'pass');

// detector 来自 adapter：阻塞性 finding → detector 阻塞；advisory finding → 提醒；adapter 不可用 → 阻塞（不伪装通过）
const cleanDom = { ...base, domHtml: '<html lang="zh"><title>T</title><h1>x</h1>正文', usedColors: [] };
assert.equal(byCheck(analyzeSnapshot(cleanDom, spec, palette, gap, detBlock)).detector, 'block');
assert.equal(byCheck(analyzeSnapshot(cleanDom, spec, palette, gap, detAdvisory)).detector, 'advisory');
assert.equal(byCheck(analyzeSnapshot(cleanDom, spec, palette, gap, detUnavailable)).detector, 'block');

// 空白 → dom 阻塞
assert.equal(byCheck(analyzeSnapshot({ ...base, domHtml: '<html></html>', usedColors: [] }, spec, palette, gap, detPass)).dom, 'block');

// 实现页 a11y 只提醒（缺 lang + img 无 alt）
const a11y = analyzeSnapshot({ ...base, domHtml: '<html><title>T</title><body><h1>x</h1>正文<img src="a"></body></html>', usedColors: [] }, spec, palette, gap, detPass);
assert.equal(byCheck(a11y).a11y, 'advisory');

// 无调色板 → token not-run
assert.equal(byCheck(analyzeSnapshot({ ...base, domHtml: '<html lang="zh"><title>T</title>正文', usedColors: ['rgb(1,2,3)'] }, spec, null, gap, detPass)).token, 'not-run');

// GapReport schema
const ok = GapReportSchema.safeParse({ schemaVersion: 1, slug: 'x', url: 'u', viewport: vp, designVersion: null, at: 'now', captureStatus: 'ok', checks: clean, blockingCount: 0, warningCount: 1, screenshotPath: null, note: '' });
assert.equal(ok.success, true);
assert.equal(GapReportSchema.safeParse({ slug: 'x' }).success, false);

console.log('GAP T10 (pure) VERIFY: ALL PASS');

// ---------- 真·浏览器采集 ----------
const dir = mkdtempSync(join(tmpdir(), 'adw-gappage-'));
const htmlPath = join(dir, 'page.html');
writeFileSync(htmlPath, '<!doctype html><html lang="zh"><head><title>实现页</title></head><body style="background:rgb(255,0,128)"><h1>真实页面</h1><p>来自 Chromium 的真实渲染</p></body></html>');
const snap = await capturePage(`file://${htmlPath}`, vp);
assert.equal(snap.title, '实现页');
assert.ok(snap.domHtml.includes('真实页面'));
assert.ok(snap.usedColors.some((c) => c.replace(/\s/g, '') === 'rgb(255,0,128)'), 'computed 颜色应含品红背景');
const real = analyzeSnapshot(snap, spec, palette, gap, detPass);
assert.equal(byCheck(real).token, 'block', '真实页面的离色应被 token 阻塞');
console.log('GAP T10 (chromium) VERIFY: ALL PASS  title=' + snap.title);

// 采集失败必须是 GapCaptureError（engine 据此写 failed 报告而不崩）
let captureErr = null;
try {
  await capturePage('http://127.0.0.1:59999/', vp);
} catch (e) {
  captureErr = e;
}
assert.ok(captureErr instanceof GapCaptureError, '打不开的页面应抛 GapCaptureError，而不是裸 Error');
console.log('GAP capture-failure VERIFY: ALL PASS');
