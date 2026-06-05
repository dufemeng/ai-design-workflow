// T6 可证伪验证：组装 2-3 方向、嵌入真实 H5 预览、模板注入、方向数量约束。
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG } from '../dist/config/index.js';
import { generateProposalWorkbench, ProposalSpecSchema, injectIntoShell } from '../dist/proposal/index.js';

// 注入器
assert.equal(injectIntoShell('<!-- ADW:X -->yo', { X: 'ZZ' }), 'ZZyo');

const target = mkdtempSync(join(tmpdir(), 'adw-proto-'));

const spec = ProposalSpecSchema.parse({
  directions: [
    { id: 'A', label: '密度优先', axis: '信息密度', fitScenario: '高频专家', tradeoffs: ['更密'], templateId: 'mobile-app', injections: { TITLE: '方向A标题', CONTENT: '<p>hi-A</p>' } },
    { id: 'B', label: '引导优先', axis: '转化路径', fitScenario: '新手', tradeoffs: ['更慢但清楚'], previewHtml: '<!doctype html><title>B</title><h1>预览B</h1>' },
  ],
});

const { path, count } = generateProposalWorkbench(target, DEFAULT_CONFIG, 'search', spec);
assert.equal(count, 2);
assert.ok(existsSync(path), 'workbench 文件应写出');
const html = readFileSync(path, 'utf8');

assert.ok(html.includes('密度优先') && html.includes('引导优先'), '两个方向标签都在');
assert.ok(html.includes('信息密度') && html.includes('转化路径'), '两个探索主轴都在');
assert.equal((html.match(/srcdoc=/g) || []).length, 2, '应有两个嵌入预览');
assert.ok(html.includes('方向A标题'), '模板注入的标题应进入预览');
assert.ok(html.includes('width=device-width'), '移动端 viewport meta（来自 mobile-app shell）应在');

// 数量约束：少于 2 / 多于 3 都拒绝
assert.throws(() => ProposalSpecSchema.parse({ directions: [spec.directions[0]] }), '1 个方向应拒绝');
assert.throws(() => ProposalSpecSchema.parse({ directions: [...spec.directions, spec.directions[0], spec.directions[1]] }), '4 个方向应拒绝');
// 既无 templateId 也无 previewHtml 应拒绝
assert.throws(() => ProposalSpecSchema.parse({ directions: [{ id: 'X', label: 'x', axis: 'a', fitScenario: 's' }, spec.directions[1]] }));

console.log('PROTOTYPE T6 VERIFY: ALL PASS  directions=2 previews=2');
