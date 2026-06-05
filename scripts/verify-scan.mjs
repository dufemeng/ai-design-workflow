// T3 可证伪验证：扫描识别技术栈/设计语言/flows；retrospective 正确区分「齐全」与「缺料」。
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG } from '../dist/config/index.js';
import { scanProject, retrospect } from '../dist/scan/index.js';

const target = mkdtempSync(join(tmpdir(), 'adw-scan-'));
mkdirSync(join(target, 'docs'), { recursive: true });
writeFileSync(join(target, 'README.md'), '# Demo 项目\n\n一个用于验证扫描器的示例项目。\n');
writeFileSync(join(target, 'CLAUDE.md'), '规范');
writeFileSync(join(target, 'package.json'), JSON.stringify({ name: 'demo', packageManager: 'pnpm@9', scripts: { dev: 'vite', build: 'tsc' }, dependencies: { react: '^18', 'react-router-dom': '^6' } }));
writeFileSync(join(target, 'DESIGN.md'), '# design');
writeFileSync(join(target, 'PRODUCT.md'), '# product');

// 齐全的 flow：route + 3 个状态 + 验收 + html
writeFileSync(
  join(target, 'docs', 'design-complete.md'),
  '# 结账流程\n目标 route：/checkout\n## 状态\n- 空：购物车为空\n- 加载：拉取中\n- 错误：网络失败\n## 验收规则\n- 点击结算跳转成功页\n',
);
writeFileSync(join(target, 'docs', 'design-complete.html'), '<!doctype html><title>c</title>');

// 缺料的 flow：什么都没有，也没有 html
writeFileSync(join(target, 'docs', 'design-bare.md'), '# 一些想法\n这是一段随意的说明文字，什么结构都没有。\n');

// --- scan ---
const snap = scanProject(target, DEFAULT_CONFIG);
assert.equal(snap.purpose.readmeTitle, 'Demo 项目');
assert.equal(snap.purpose.hasClaudeMd, true);
assert.ok(snap.techStack.frameworks.includes('React'), 'should detect React');
assert.ok(snap.techStack.frameworks.includes('React Router'));
assert.equal(snap.techStack.packageManager, 'pnpm');
assert.ok(snap.techStack.startCommands.includes('pnpm dev'));
assert.equal(snap.designLanguage.hasDesignMd, true);
assert.equal(snap.designLanguage.hasProductMd, true);
assert.equal(snap.designFlows.length, 2);

// --- retrospect ---
const r = retrospect(target, DEFAULT_CONFIG);
const complete = r.flows.find((f) => f.slug === 'complete');
const bare = r.flows.find((f) => f.slug === 'bare');
assert.ok(complete && bare);
assert.equal(complete.gapLoopReady, true, '齐全的应判为可跑');
assert.deepEqual(complete.missing, []);
assert.equal(bare.gapLoopReady, false, '缺料的应判为不可跑');
assert.deepEqual(bare.missing.sort(), ['HTML 设计稿', '机器可读状态清单', '目标 route', '验收规则'].sort());
assert.equal(r.totals.gapLoopReady, 1);

console.log('SCAN T3 VERIFY: ALL PASS  flows=2 ready=1');
