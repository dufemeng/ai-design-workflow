// T11 可证伪验证：契约判定 + loop（收敛 / 没进展回滚 / 到顶转 live / 只剩人工项）。
import assert from 'node:assert/strict';
import { decide, splitFindings, runAutoFixLoop, AUTOFIXABLE_CHECKS } from '../dist/autofix/index.js';

// 契约判定
assert.equal(decide(2, 0, 1, 3).decision, 'stop-converged');
assert.equal(decide(2, 2, 1, 3).decision, 'stop-no-progress');
assert.equal(decide(2, 1, 1, 3).decision, 'continue');
assert.equal(decide(2, 1, 3, 3).decision, 'stop-max-rounds');

// 切分：token 可自动修，state 阻塞转 live
const split = splitFindings([
  { check: 'token', status: 'block', findings: [] },
  { check: 'state', status: 'block', findings: [] },
  { check: 'a11y', status: 'advisory', findings: [] },
]);
assert.deepEqual(split.autoFixable.map((c) => c.check), ['token']);
assert.deepEqual(split.toLive.map((c) => c.check), ['state']);
assert.deepEqual(AUTOFIXABLE_CHECKS, ['token', 'dom', 'detector']);

function makeDeps(queue, { manual = false } = {}) {
  const calls = { rollback: 0, intents: 0, fixes: 0 };
  const checksFor = (n) => (n > 0 ? [{ check: manual ? 'state' : 'token', status: 'block', findings: [] }] : []);
  let i = 0;
  return {
    calls,
    runGap: async () => {
      const n = queue[Math.min(i++, queue.length - 1)];
      return { blockingCount: n, checks: checksFor(n) };
    },
    applyFix: async () => {
      calls.fixes++;
      return { changed: true, patchRef: `p${calls.fixes}`, purpose: '修一类' };
    },
    rollback: async () => {
      calls.rollback++;
    },
    recordIntent: () => {
      calls.intents++;
    },
  };
}

// 收敛：2→1→0
let d = makeDeps([2, 1, 0]);
let out = await runAutoFixLoop(d);
assert.equal(out.decision, 'stop-converged');
assert.equal(out.finalBlocking, 0);
assert.equal(out.rounds, 2);
assert.equal(d.calls.rollback, 0);

// 没进展：2→2 → 回滚、转 live
d = makeDeps([2, 2]);
out = await runAutoFixLoop(d);
assert.equal(out.decision, 'stop-no-progress');
assert.equal(out.rounds, 1);
assert.equal(d.calls.rollback, 1, '应回滚本轮');

// 到顶：4→3→2→1（三轮仍有阻塞）转 live
d = makeDeps([4, 3, 2, 1]);
out = await runAutoFixLoop(d, 3);
assert.equal(out.decision, 'stop-max-rounds');
assert.equal(out.rounds, 3);
assert.equal(out.finalBlocking, 1);

// 只剩人工项：阻塞但无可自动修
d = makeDeps([1], { manual: true });
out = await runAutoFixLoop(d);
assert.equal(out.decision, 'stop-no-progress');
assert.equal(out.rounds, 0);
assert.equal(out.toLive.length, 1);

console.log('AUTOFIX T11 VERIFY: ALL PASS');
