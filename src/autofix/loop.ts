import type { CheckResult } from '../gap/analyze.js';
import { type AutoFixDecision, decide, splitFindings } from './contract.js';

/**
 * 自动修复 loop 的依赖（注入）。真正改代码的是 agent（applyFix），
 * 本 loop 只负责强制安全契约：单类、可回滚、每轮必须降、最多三轮。
 */
export interface AutoFixDeps {
  /** 跑一轮 gap，返回阻塞数与各检查结果。 */
  runGap: () => Promise<{ blockingCount: number; checks: CheckResult[] }>;
  /** agent 修一类问题；changed=false 表示没真正改动。patch 必须可单独回滚。 */
  applyFix: (check: CheckResult) => Promise<{ changed: boolean; patchRef: string; purpose: string }>;
  rollback: (patchRef: string) => Promise<void>;
  recordIntent: (intent: { purpose: string; scope: string; needsReverify: boolean }) => void;
}

export interface AutoFixOutcome {
  rounds: number;
  finalBlocking: number;
  decision: AutoFixDecision;
  log: string[];
  toLive: CheckResult[];
}

export async function runAutoFixLoop(deps: AutoFixDeps, maxRounds = 3): Promise<AutoFixOutcome> {
  const log: string[] = [];
  let { blockingCount, checks } = await deps.runGap();
  log.push(`初始阻塞：${blockingCount}`);
  let round = 0;
  let decision: AutoFixDecision = blockingCount === 0 ? 'stop-converged' : 'continue';

  while (round < maxRounds) {
    if (blockingCount === 0) {
      decision = 'stop-converged';
      break;
    }
    const split = splitFindings(checks);
    const target = split.autoFixable[0];
    if (!target) {
      decision = 'stop-no-progress';
      log.push('没有可自动修复的阻塞项，转人工 live。');
      break;
    }

    round++;
    const fix = await deps.applyFix(target);
    deps.recordIntent({ purpose: fix.purpose, scope: target.check, needsReverify: true });
    if (!fix.changed) {
      await deps.rollback(fix.patchRef);
      decision = 'stop-no-progress';
      log.push(`第 ${round} 轮修 ${target.check}：未产生改动，回滚、转 live。`);
      break;
    }

    const prev = blockingCount;
    const res = await deps.runGap();
    const dec = decide(prev, res.blockingCount, round, maxRounds);
    log.push(`第 ${round} 轮修 ${target.check}：${dec.reason}`);

    if (dec.decision === 'stop-no-progress') {
      await deps.rollback(fix.patchRef);
      decision = 'stop-no-progress';
      checks = res.checks;
      blockingCount = res.blockingCount;
      break;
    }

    blockingCount = res.blockingCount;
    checks = res.checks;
    if (dec.decision !== 'continue') {
      decision = dec.decision;
      break;
    }
  }

  return { rounds: round, finalBlocking: blockingCount, decision, log, toLive: splitFindings(checks).toLive };
}
