// T7 可证伪验证：机器可读 frontmatter 往返、HTML baseline、准入硬门、约束校验。
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG } from '../dist/config/index.js';
import { DesignFlowSpecSchema, writeDesignFlow, parseDesignFlow, readinessForCode } from '../dist/design-flow/index.js';

const raw = {
  flow: 'search',
  title: '搜索改版',
  designVersion: 'sha256:abc',
  screens: [{ id: 'home', name: '首页', mockHtml: '<!doctype html><h1>MOCK-HOME</h1>' }],
  states: [
    { id: 'home-empty', screenId: 'home', kind: 'empty', description: '无结果', driver: { type: 'query-param', params: { state: 'empty' } }, expected: { urlIncludes: 'state=empty' } },
    { id: 'home-loading', screenId: 'home', kind: 'loading', notTestableReason: '加载态瞬时出现，运行期通过后续 T15 driver 单独补。' },
  ],
  interactions: [
    { id: 'open-filter', screenId: 'home', description: '打开筛选', driver: { steps: [{ action: 'click', selector: '#filter' }], expected: { selector: '#filter-panel' } } },
  ],
  targetRoute: '/search',
  acceptanceRules: [{ id: 'a1', rule: '空态有引导', screenId: 'home' }],
};
const spec = DesignFlowSpecSchema.parse(raw);

const target = mkdtempSync(join(tmpdir(), 'adw-df-'));
const { mdPath, htmlPath } = writeDesignFlow(target, DEFAULT_CONFIG, spec);
assert.ok(existsSync(mdPath) && existsSync(htmlPath));

const md = readFileSync(mdPath, 'utf8');
const html = readFileSync(htmlPath, 'utf8');

// frontmatter 机器可读，能往返
const roundtrip = parseDesignFlow(md);
assert.equal(roundtrip.states.length, 2);
assert.equal(roundtrip.interactions.length, 1);
assert.equal(roundtrip.targetRoute, '/search');
assert.equal(roundtrip.acceptanceRules.length, 1);

// 正文人读
assert.ok(md.includes('## 屏幕与状态'), '正文应有人读小节');
assert.ok(md.includes('sha256:abc') && md.includes('/search'));
// mockHtml 不进 md（presentation 不污染机器可读 spec）
assert.ok(!md.includes('MOCK-HOME'), 'mockHtml 不应出现在 md');

// HTML baseline 带可机读属性
assert.ok(html.includes('data-screen="home"'));
assert.ok(html.includes('data-design-version="sha256:abc"'));
assert.ok(html.includes('data-kind="empty"'));
assert.ok(html.includes('open-filter'));
assert.ok(html.includes('MOCK-HOME'), 'mockHtml 应嵌入 HTML 设计稿');

// 准入硬门
assert.equal(readinessForCode(spec).ready, true);
const noStates = DesignFlowSpecSchema.parse({ ...raw, states: [] });
const r = readinessForCode(noStates);
assert.equal(r.ready, false);
assert.ok(r.missing.includes('机器可读状态清单'));
const missingDriver = DesignFlowSpecSchema.parse({ ...raw, states: [{ id: 'home-empty', screenId: 'home', kind: 'empty' }] });
assert.equal(readinessForCode(missingDriver).ready, false);
assert.ok(readinessForCode(missingDriver).missing.some((m) => m.includes('状态驱动方式')));

// 约束校验
assert.throws(() => DesignFlowSpecSchema.parse({ ...raw, deviations: [{ rule: 'x' }] }), '偏离缺理由应拒绝');
assert.throws(() => DesignFlowSpecSchema.parse({ ...raw, states: [{ id: 's', screenId: 'nope', kind: 'empty' }] }), '状态引用不存在屏幕应拒绝');

console.log('DESIGN-FLOW T7 VERIFY: ALL PASS  screens=1 states=2');
