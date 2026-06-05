// T8 可证伪验证：确定性层能真打回各类问题；判断层只认带证据的致命意见。
import assert from 'node:assert/strict';
import { DesignFlowSpecSchema, renderDesignArtifactHtml } from '../dist/design-flow/index.js';
import { runDeterministicRules, evaluateJudgment } from '../dist/review/index.js';

const raw = {
  flow: 'search',
  title: '搜索',
  designVersion: 'sha256:abc',
  screens: [{ id: 'home', name: '首页' }],
  states: [
    { id: 's1', screenId: 'home', kind: 'empty' },
    { id: 's2', screenId: 'home', kind: 'loading' },
    { id: 's3', screenId: 'home', kind: 'error' },
  ],
  targetRoute: '/search',
  acceptanceRules: [{ id: 'a1', rule: '空态有引导' }],
};
const spec = DesignFlowSpecSchema.parse(raw);
const goodHtml = renderDesignArtifactHtml(spec);

// 好稿：确定性层无 block
const det = runDeterministicRules(goodHtml, spec, ['#faff69']);
assert.equal(det.filter((d) => d.severity === 'block').length, 0, '好稿不应被确定性层 block');

const blocks = (html, s, pal = null) => runDeterministicRules(html, s, pal).filter((d) => d.severity === 'block').map((d) => d.rule);

// viewport 缺失
assert.ok(blocks('<html lang="x"><title>t</title></html>', spec).includes('viewport'));
// 状态清单缺失（屏幕 0 状态）
assert.ok(blocks(goodHtml, DesignFlowSpecSchema.parse({ ...raw, states: [] })).includes('state-coverage'));
// a11y：缺 lang
assert.ok(blocks('<html><title>t</title><body></body></html>', spec).includes('a11y'));
// tap target < 44
assert.ok(blocks(goodHtml, DesignFlowSpecSchema.parse({ ...raw, h5Constraints: { tapTargetMinPx: 30 } })).includes('tap-target'));
// detector slop
assert.ok(blocks(goodHtml.replace('</main>', 'Lorem Ipsum</main>'), spec).includes('detector'));
// token 漂移只提醒不阻塞
assert.ok(!blocks(goodHtml, spec, ['#faff69']).includes('token-drift'));
assert.ok(runDeterministicRules(goodHtml, spec, ['#faff69']).some((d) => d.rule === 'token-drift' && d.severity === 'advisory'));

// 判断层：带证据致命 → 阻塞；无证据致命 → 不算数；advisory → 不阻塞
const j1 = evaluateJudgment({ findings: [{ dimension: 'product-thesis', severity: 'fatal', message: '命题错', evidence: { screen: 'home' } }] });
assert.equal(j1.blocking.length, 1);
const j2 = evaluateJudgment({ findings: [{ dimension: 'ia', severity: 'fatal', message: '空话无实锤', evidence: {} }] });
assert.equal(j2.blocking.length, 0);
assert.equal(j2.fatalWithoutEvidence.length, 1);
const j3 = evaluateJudgment({ findings: [{ dimension: 'copy', severity: 'advisory', message: '小问题', evidence: {} }] });
assert.equal(j3.advisory.length, 1);
assert.equal(j3.blocking.length, 0);

console.log('REVIEW T8 VERIFY: ALL PASS  det-rules + judgment-contract');
