// T5 可证伪验证：维度收敛驱动；信息不足不能发散，足够才 canDiverge；T1 旧验证不回归。
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FlowLedgerStore } from '../dist/flow/index.js';
import { convergence, nextDimension, EXPLORATION_DIMENSIONS } from '../dist/proposal/index.js';

const target = mkdtempSync(join(tmpdir(), 'adw-prop-'));
mkdirSync(join(target, 'docs'), { recursive: true });
const store = new FlowLedgerStore(target, 'docs');

let l = store.create({ slug: 'search', title: '搜索改版' });

// 刚开始：一个维度都没解决，不能发散
let conv = convergence(l);
assert.equal(conv.canDiverge, false, '刚开始不能发散');
assert.equal(conv.missing.length, EXPLORATION_DIMENSIONS.length);
assert.equal(nextDimension(l).id, 'target-user', '第一个该问目标用户');

// 逐个解决维度
for (const dim of EXPLORATION_DIMENSIONS) {
  l = store.apply('search', { type: 'recordQuestionAnswer', question: dim.question, answer: '已确认', resolvesDimension: dim.id });
}

// 全解决后：可以发散
conv = convergence(l);
assert.equal(conv.canDiverge, true, '全维度解决后可发散');
assert.equal(conv.missing.length, 0);
assert.equal(nextDimension(l), null, '没有下一个要问的维度');
assert.equal(l.exploration.resolvedDimensions.length, EXPLORATION_DIMENSIONS.length);

// 重复 resolve 不会重复累加
l = store.apply('search', { type: 'recordQuestionAnswer', question: '再问目标用户', answer: 'x', resolvesDimension: 'target-user' });
assert.equal(l.exploration.resolvedDimensions.length, EXPLORATION_DIMENSIONS.length, '维度去重');

// 续跑：换实例读盘，收敛状态保留
const reopened = new FlowLedgerStore(target, 'docs').read('search');
assert.equal(convergence(reopened).canDiverge, true);

console.log('PROPOSAL T5 VERIFY: ALL PASS  dims=' + EXPLORATION_DIMENSIONS.length);
