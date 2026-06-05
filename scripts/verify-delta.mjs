// T13 可证伪验证：propose 不写 DESIGN.md；空 delta 拒绝；confirm 才落地并出新版本。
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG } from '../dist/config/index.js';
import { proposeDesignDelta, confirmDesignDelta, DesignDeltaInputSchema, DesignDeltaError } from '../dist/design/index.js';
import { parseDesignMd } from '../dist/design/index.js';

const target = mkdtempSync(join(tmpdir(), 'adw-delta-'));
const designMd = `---
name: 示例
colors:
  brand: "#faff69"
  ink: "#0a0a0a"
typography:
  display:
    fontFamily: "Inter"
    fontSize: "24px"
---

# Design System

## 6. Do's and Don'ts
`;
writeFileSync(join(target, 'DESIGN.md'), designMd);
const before = readFileSync(join(target, 'DESIGN.md'), 'utf8');

// 空 delta 拒绝
assert.throws(() => DesignDeltaInputSchema.parse({ id: 'd1', reason: 'x' }), '空 delta 应拒绝');

// propose：写提案 + 确认页，但不动 DESIGN.md
const input = DesignDeltaInputSchema.parse({
  id: 'd1',
  reason: '品牌主色升级，影响多个后续需求',
  provenance: { flow: 'search', review: 'design-review-3' },
  colorChanges: [{ key: 'brand', to: '#00ff88' }],
  affectedComponents: ['Button', 'StatusBadge'],
});
const { proposalPath, confirmationPath } = proposeDesignDelta(target, DEFAULT_CONFIG, input);
assert.ok(existsSync(proposalPath) && existsSync(confirmationPath));
assert.equal(readFileSync(join(target, 'DESIGN.md'), 'utf8'), before, 'propose 不能改 DESIGN.md');

const proposal = JSON.parse(readFileSync(proposalPath, 'utf8'));
assert.equal(proposal.colorChanges[0].from, '#faff69', '应记录 from（旧值）');
assert.equal(proposal.colorChanges[0].to, '#00ff88');
const confHtml = readFileSync(confirmationPath, 'utf8');
assert.ok(confHtml.includes('#faff69') && confHtml.includes('#00ff88'), '确认页应显示前后色');
assert.ok(confHtml.includes('确认前不会改根 DESIGN.md'));

// confirm：唯一会写 DESIGN.md 的入口
const { designVersion } = confirmDesignDelta(target, DEFAULT_CONFIG, 'd1');
const after = readFileSync(join(target, 'DESIGN.md'), 'utf8');
assert.notEqual(after, before, 'confirm 应改 DESIGN.md');
const tokens = parseDesignMd(after).tokens;
assert.equal(tokens.colors.brand, '#00ff88', 'brand 应被改为新值');
assert.equal(tokens.colors.ink, '#0a0a0a', '其它 token 不动');
assert.ok(designVersion.startsWith('sha256:'));
assert.ok(existsSync(join(target, 'docs', 'assets', '_design-delta', 'd1.applied.json')), '应留 provenance 落档');

// 没有 DESIGN.md → propose 报错
const empty = mkdtempSync(join(tmpdir(), 'adw-delta2-'));
assert.throws(() => proposeDesignDelta(empty, DEFAULT_CONFIG, input), DesignDeltaError);

console.log('DELTA T13 VERIFY: ALL PASS  propose→confirm，frontmatter 合并正确');
