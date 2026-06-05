import type { PatchIntent } from '../flow/schema.js';

/** T12：live 修改的运行数据。MVP 不提前重构 live 链路，先用这些数据决定怎么优化。 */
export interface LiveMetrics {
  count: number;
  accepted: number;
  rejected: number;
  abandoned: number;
  /** 返工率 =（拒绝 + 放弃）/ 总数。 */
  reworkRate: number;
  avgDurationMs: number | null;
  needReverify: number;
}

export function liveMetrics(history: PatchIntent[]): LiveMetrics {
  const live = history.filter((p) => p.source === 'live');
  const count = live.length;
  const accepted = live.filter((p) => p.result === 'accepted').length;
  const rejected = live.filter((p) => p.result === 'rejected').length;
  const abandoned = live.filter((p) => p.result === 'abandoned').length;
  const durations = live.map((p) => p.durationMs).filter((d): d is number => typeof d === 'number');
  const avgDurationMs = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;
  return {
    count,
    accepted,
    rejected,
    abandoned,
    reworkRate: count ? (rejected + abandoned) / count : 0,
    avgDurationMs,
    needReverify: live.filter((p) => p.needsReverify).length,
  };
}
