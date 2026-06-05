import type { GapCheck } from '../config/schema.js';
import type { CheckResult } from '../gap/analyze.js';

/** 只有「确定性可验证」的检查才允许自动改；其余阻塞项交人工 live。 */
export const AUTOFIXABLE_CHECKS: GapCheck[] = ['token', 'dom', 'detector'];

export interface FixSplit {
  autoFixable: CheckResult[];
  toLive: CheckResult[];
}

export function splitFindings(checks: CheckResult[]): FixSplit {
  const autoFixable: CheckResult[] = [];
  const toLive: CheckResult[] = [];
  for (const c of checks) {
    if (c.status !== 'block') continue;
    if (AUTOFIXABLE_CHECKS.includes(c.check)) autoFixable.push(c);
    else toLive.push(c);
  }
  return { autoFixable, toLive };
}

export type AutoFixDecision = 'stop-converged' | 'stop-no-progress' | 'stop-max-rounds' | 'continue';

/** 每轮后的去留判定：收敛 / 没进展（回滚）/ 到顶 / 继续。 */
export function decide(prevBlocking: number, newBlocking: number, round: number, maxRounds: number): { decision: AutoFixDecision; reason: string } {
  if (newBlocking === 0) return { decision: 'stop-converged', reason: '阻塞已清。' };
  if (newBlocking >= prevBlocking) return { decision: 'stop-no-progress', reason: `阻塞数没下降（${prevBlocking}→${newBlocking}），回滚本轮、转人工 live。` };
  if (round >= maxRounds) return { decision: 'stop-max-rounds', reason: `到顶（${maxRounds} 轮）仍有 ${newBlocking} 个阻塞，转人工 live。` };
  return { decision: 'continue', reason: `阻塞 ${prevBlocking}→${newBlocking}，继续下一轮。` };
}

/** 自动修复安全契约（写进文档/报告，运行时由 loop 强制）。 */
export const AUTOFIX_CONTRACT: string[] = [
  '只自动修复确定性可验证的问题（token / dom / detector）。',
  '每个 patch 只处理一类问题，必须能单独回滚。',
  '每轮重跑 gap，阻塞数必须下降；不降则回滚本轮。',
  '出现新高风险问题或需要猜产品意图，立即停止。',
  '最多三轮，到顶仍未清则转人工 live。',
  '信息架构 / 产品命题 / 视觉方向 / 主观取舍不自动改，只生成建议。',
];
