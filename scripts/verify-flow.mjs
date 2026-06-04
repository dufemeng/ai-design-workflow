// T1 可证伪验证：happy path + 每个 invariant 阻塞 + slug 唯一 + 续跑 + eventLog append-only。
// 用法：node scripts/verify-flow.mjs（需先 pnpm build）。
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FlowLedgerStore, LedgerError, InvariantError } from '../dist/flow/index.js';

const target = mkdtempSync(join(tmpdir(), 'adw-flow-'));
mkdirSync(join(target, 'docs'), { recursive: true });
writeFileSync(join(target, 'docs', 'proposal-checkout.html'), '<html>');
writeFileSync(join(target, 'docs', 'design-checkout.md'), '# design');
writeFileSync(join(target, 'docs', 'design-checkout.html'), '<html>');

const store = new FlowLedgerStore(target, 'docs');

// 1) create
let l = store.create({ slug: 'checkout', title: '结账流程' });
assert.equal(l.currentStage, 'proposal');
assert.equal(l.eventLog.length, 1);
assert.equal(l.eventLog[0].seq, 0);

// 2) slug 唯一：同 slug 再建必须拒绝
assert.throws(() => store.create({ slug: 'checkout', title: 'x' }), LedgerError, '同 slug 应拒绝');

// 3) 第二条 flow 独立，不动第一条
store.create({ slug: 'profile', title: '资料页' });
assert.equal(store.read('checkout').title, '结账流程');

// 4) 非法跳步：没原型就批准
assert.throws(() => store.apply('checkout', { type: 'approvePrototype', selection: 'A' }), InvariantError);

// 5) happy path
store.apply('checkout', { type: 'recordQuestionAnswer', question: '目标用户?', answer: '移动端买家', assumption: '移动优先' });
store.apply('checkout', { type: 'attachPrototype', htmlPath: 'docs/proposal-checkout.html', label: '方向A' });
l = store.apply('checkout', { type: 'approvePrototype', selection: '方向A' });
assert.equal(l.currentStage, 'design');

// attach 不存在的设计稿必须挡
assert.throws(() => store.apply('checkout', { type: 'attachDesignArtifact', designMd: 'docs/nope.md', designHtml: 'docs/design-checkout.html', designVersion: 'v1' }), InvariantError);
// 没 attach 就 review 必须挡
assert.throws(() => store.apply('checkout', { type: 'runDesignReview', passed: true, blockingReasons: [] }), InvariantError);

store.apply('checkout', { type: 'attachDesignArtifact', designMd: 'docs/design-checkout.md', designHtml: 'docs/design-checkout.html', designVersion: 'sha-abc' });
// 审查没过就批准必须挡
assert.throws(() => store.apply('checkout', { type: 'approveDesign' }), InvariantError);
// 审查 blocked
l = store.apply('checkout', { type: 'runDesignReview', passed: false, blockingReasons: ['产品命题错'] });
assert.equal(l.reviewStatus.state, 'blocked');
assert.throws(() => store.apply('checkout', { type: 'approveDesign' }), InvariantError);
// 审查通过
store.apply('checkout', { type: 'runDesignReview', passed: true, blockingReasons: [] });
l = store.apply('checkout', { type: 'approveDesign' });
assert.equal(l.currentStage, 'code');

// 没实现目标就记 gap 必须挡
assert.throws(() => store.apply('checkout', { type: 'attachGapReport', reportRef: 'docs/assets/checkout/gap-0.json', blockingCount: 0, warningCount: 0 }), InvariantError);
store.apply('checkout', { type: 'attachImplementationTarget', route: '/checkout', needsAuthedSession: true });

// round1：阻塞 2 → markDone 必须挡
store.apply('checkout', { type: 'attachGapReport', reportRef: 'docs/assets/checkout/gap-0.json', blockingCount: 2, warningCount: 1 });
assert.throws(() => store.apply('checkout', { type: 'markDone', acceptRemainingWarnings: true }), InvariantError);
store.apply('checkout', { type: 'recordPatchIntent', intent: { source: 'auto-fix', purpose: '修按钮颜色', scope: 'CTA', needsReverify: true } });

// round2：阻塞 0 提醒 1
store.apply('checkout', { type: 'attachGapReport', reportRef: 'docs/assets/checkout/gap-1.json', blockingCount: 0, warningCount: 1, autoFixApplied: true });
// 还有提醒、没确认接受 → 挡
assert.throws(() => store.apply('checkout', { type: 'markDone', acceptRemainingWarnings: false }), InvariantError);
// 确认接受 → 完成
l = store.apply('checkout', { type: 'markDone', acceptRemainingWarnings: true });
assert.equal(l.currentStage, 'done');
assert.equal(l.currentGate, null);

// 6) eventLog append-only，seq 单调 0..n
const seqs = l.eventLog.map((e) => e.seq);
assert.deepEqual(seqs, seqs.map((_, i) => i), 'seq 必须 0..n 连续');
assert.equal(l.gapHistory.length, 2);
assert.equal(l.gapHistory[0].round, 0);
assert.equal(l.gapHistory[1].round, 1);

// 7) 续跑：全新 store 实例读盘，状态与 resumePointer 完好
const reopened = new FlowLedgerStore(target, 'docs').read('checkout');
assert.equal(reopened.currentStage, 'done');
assert.deepEqual(reopened.resumePointer.nextActions, []);

console.log(`FLOW T1 VERIFY: ALL PASS  events=${l.eventLog.length} gapRounds=${l.gapHistory.length}`);
