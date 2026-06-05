// T4 可证伪验证：冷启动写草稿不写 DESIGN.md；已存在则只评审不改；confirm 才落地。
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG } from '../dist/config/index.js';
import { bootstrapDesignLanguage, confirmDesignLanguage } from '../dist/design/index.js';

// ---------- 场景 A：缺 DESIGN.md ----------
const a = mkdtempSync(join(tmpdir(), 'adw-dsA-'));
mkdirSync(join(a, 'styles'), { recursive: true });
writeFileSync(join(a, 'styles', 'app.css'), ':root{--brand:#faff69;--ink:#0a0a0a;} .x{color:#22c55e;}');

const seeded = bootstrapDesignLanguage(a, DEFAULT_CONFIG, {});
assert.equal(seeded.action, 'seed-draft');
// 写策略：bootstrap 绝不写最终 DESIGN.md
assert.equal(existsSync(join(a, 'DESIGN.md')), false, 'bootstrap 不能写 DESIGN.md');
assert.equal(existsSync(seeded.draftPath), true, '应有草稿');
assert.equal(existsSync(seeded.confirmationPath), true, '应有确认页');
// 草稿种子里应含从 css 抓到的颜色
const draftText = readFileSync(seeded.draftPath, 'utf8');
assert.ok(draftText.includes('#faff69'), '草稿应含扫描到的品牌色');
assert.ok(draftText.includes('ADW DRAFT'), '草稿应带 DRAFT 标记');

// confirm 才落地，且去掉 DRAFT 标记
const confirmed = confirmDesignLanguage(a, DEFAULT_CONFIG);
assert.equal(existsSync(join(a, 'DESIGN.md')), true, 'confirm 后应有 DESIGN.md');
const finalText = readFileSync(join(a, 'DESIGN.md'), 'utf8');
assert.ok(!finalText.includes('ADW DRAFT'), 'confirm 后应去掉 DRAFT 标记');
assert.ok(confirmed.designVersion.startsWith('sha256:'), 'confirm 返回 designVersion');

// ---------- 场景 B：已有 DESIGN.md ----------
const b = mkdtempSync(join(tmpdir(), 'adw-dsB-'));
mkdirSync(join(b, 'docs'), { recursive: true });
const existing = `---
name: 示例设计系统
description: 演示用调性
colors:
  primary: "#4f7cff"
  ink: "#111111"
typography:
  display:
    fontFamily: "Inter"
    fontSize: "28px"
    fontWeight: 700
---

# Design System

## 6. Do's and Don'ts
### Do
- 保持一致
### Don't
- 别用纯黑
`;
writeFileSync(join(b, 'DESIGN.md'), existing);
const before = readFileSync(join(b, 'DESIGN.md'), 'utf8');

const review = bootstrapDesignLanguage(b, DEFAULT_CONFIG, {});
assert.equal(review.action, 'review');
assert.equal(readFileSync(join(b, 'DESIGN.md'), 'utf8'), before, '评审模式不能改 DESIGN.md');
assert.ok(review.designVersion.startsWith('sha256:'));
assert.equal(existsSync(review.confirmationPath), true);
const html = readFileSync(review.confirmationPath, 'utf8');
assert.ok(html.includes('#4f7cff'), '确认页应渲染真实色板');
assert.ok(html.includes('示例设计系统'), '确认页应含产品名');
assert.ok(html.includes('别用纯黑'), '确认页应抓到 Don\'t 条目');

// refresh 模式也不直接改 DESIGN.md
const refreshed = bootstrapDesignLanguage(b, DEFAULT_CONFIG, { refresh: true });
assert.equal(refreshed.action, 'refresh-draft');
assert.equal(readFileSync(join(b, 'DESIGN.md'), 'utf8'), before, 'refresh 也不能直接改 DESIGN.md');
assert.equal(existsSync(refreshed.draftPath), true);

console.log('DESIGN T4 VERIFY: ALL PASS  seed/confirm/review/refresh');
