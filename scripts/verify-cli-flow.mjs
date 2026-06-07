// T16 端到端可复验：用真实 dist/cli.js 跑通 flow:create → ... → flow:done，
// 证明四个生命周期命令经 CLI 端到端可达，全程不手改 workflow.json。
// detector 用 ADW_IMPECCABLE_BIN 桩（输出 []）避免依赖真 impeccable 安装。
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = join(process.cwd(), 'dist', 'cli.js');
assert.ok(existsSync(CLI), 'dist/cli.js 不存在，先 npm run build');

const target = mkdtempSync(join(tmpdir(), 'adw-e2e-'));
mkdirSync(join(target, 'docs'), { recursive: true });

// impeccable detect 桩：输出空 findings → detector 通过（不依赖真 impeccable）
const stub = join(target, 'impeccable-stub.mjs');
writeFileSync(stub, '#!/usr/bin/env node\nprocess.stdout.write("[]");\n');
chmodSync(stub, 0o755);

const env = { ...process.env, ADW_IMPECCABLE_BIN: stub };
const run = (...args) => {
  try {
    return execFileSync('node', [CLI, ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    throw new Error(`命令失败 (exit ${e.status})：adw ${args.join(' ')}\n--- stdout ---\n${e.stdout ?? ''}\n--- stderr ---\n${e.stderr ?? ''}`);
  }
};

const slug = 'checkout';

// 1) 创建 flow（接线前不可能）
run('flow:create', target, slug, 'E2E 结账流程');
assert.ok(existsSync(join(target, 'docs', `design-${slug}.workflow.json`)), 'workflow.json 应被创建');

// 2) 探索问答落账
run('proposal:answer', target, slug, '目标用户？', '老用户', '--dimension', 'target-user');

// 3) 生成原型 + 选定
const directions = join(target, 'directions.json');
writeFileSync(directions, JSON.stringify({ directions: [
  { id: 'A', label: '密度优先', axis: '信息密度', fitScenario: '高频', tradeoffs: ['更密'], previewHtml: '<!doctype html><title>A</title><h1>A</h1>' },
  { id: 'B', label: '引导优先', axis: '转化', fitScenario: '新手', tradeoffs: ['更慢'], previewHtml: '<!doctype html><title>B</title><h1>B</h1>' },
] }));
run('proposal:generate', target, slug, directions);
run('proposal:approve', target, slug, 'A');

// 4) 生成正式设计稿（含 error 状态以过状态覆盖门）
const spec = join(target, 'spec.json');
writeFileSync(spec, JSON.stringify({
  flow: slug, title: 'E2E 结账', designVersion: 'sha256:e2e',
  screens: [{ id: 'home', name: '首页' }],
  states: [
    { id: 's-empty', screenId: 'home', kind: 'empty' },
    { id: 's-loading', screenId: 'home', kind: 'loading' },
    { id: 's-error', screenId: 'home', kind: 'error' },
    { id: 's-success', screenId: 'home', kind: 'success' },
  ],
  targetRoute: '/checkout',
  acceptanceRules: [{ id: 'a1', rule: '空态有引导' }],
}));
run('design:flow-generate', target, slug, spec);

// 5) 审查门：detector 用桩 → 通过；judgment 空 → 无致命；确定性层应全过
const reviewOut = run('design:review', target, slug);
assert.ok(reviewOut.includes('通过'), `审查门应通过，实际：\n${reviewOut}`);

// 6) 批准进入 Code（接线前 approveDesign 无命令）
const approveOut = run('design:approve', target, slug);
assert.ok(/code|Code/.test(approveOut), `应进入 code 阶段，实际：\n${approveOut}`);

// 7) 设定实现目标 + 跑 gap（实现页用 file://，detector 桩通过）
const page = join(target, 'impl.html');
writeFileSync(page, '<!doctype html><html lang="zh"><head><title>结账</title></head><body><h1>结账页</h1><p>实现内容足够长用于体检</p></body></html>');
run('code:target', target, slug, `file://${page}`, '--no-auth');
run('gap:run', target, slug, `file://${page}`);

// gap report 四件套都在（finding #2 修复后：per-runId + latest，历史不覆盖）
const assets = join(target, 'docs', 'assets', slug);
for (const f of ['gap-report-0.json', 'gap-report-0.html', 'gap-report-latest.json', 'gap-report-latest.html']) {
  assert.ok(existsSync(join(assets, f)), `应写出 ${f}`);
}

// 8) 收尾（接线前 markDone 无命令）
const doneOut = run('flow:done', target, slug, '--accept-warnings');
assert.ok(doneOut.includes('完成'), `flow 应标记完成，实际：\n${doneOut}`);

// 9) 状态确认 done
const status = run('flow:status', target, slug);
assert.ok(status.includes('已完成'), `flow:status 应显示已完成，实际：\n${status}`);

console.log('CLI-FLOW E2E VERIFY: ALL PASS  flow:create → ... → flow:done 全程经真实 CLI');
