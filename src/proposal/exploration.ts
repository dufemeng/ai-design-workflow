import type { ExplorationDimension, FlowLedger } from '../flow/schema.js';

/**
 * T5：Proposal 苏格拉底式探索循环的确定性骨架。
 * 问题的自然语言由 agent 在运行时生成；这里只负责「下一个该问哪个维度」和
 * 「信息够不够、能不能发散」——收敛按维度判定，不按固定轮数，避免变成长问卷。
 */

export interface DimensionMeta {
  id: ExplorationDimension;
  label: string;
  /** 给 agent 的起手问题模板，agent 可结合上下文改写。 */
  question: string;
  /** 为什么这个维度会影响方案。 */
  why: string;
}

export const EXPLORATION_DIMENSIONS: DimensionMeta[] = [
  { id: 'target-user', label: '目标用户', question: '这个需求主要服务谁？他们的熟练度和使用场景是什么？', why: '用户决定信息密度、术语和默认路径。' },
  { id: 'core-scenario', label: '核心场景', question: '用户在什么情境下打开这个页面，要完成什么？', why: '场景决定主路径和首屏该突出什么。' },
  { id: 'main-path', label: '主路径', question: '从进入到完成，最关键的一条操作路径是什么？', why: '主路径决定布局重心和交互流。' },
  { id: 'key-states', label: '关键状态', question: '有哪些必须覆盖的状态：空、加载、错误、成功、边界数据？', why: '状态清单是 gap loop 的 state coverage 依据。' },
  { id: 'constraints', label: '约束', question: '有哪些硬约束：H5 安全区、底部操作区、性能、已有组件、品牌？', why: '约束决定可行解空间，避免做了又推翻。' },
  { id: 'success-criteria', label: '成功标准', question: '怎么算这个需求做成了？可验证的标准是什么？', why: '成功标准转成验收规则，驱动 gap 校验。' },
];

const REQUIRED_IDS: ExplorationDimension[] = EXPLORATION_DIMENSIONS.map((d) => d.id);

/** 下一个该追问的维度（第一个未解决的），全部解决则 null。 */
export function nextDimension(ledger: FlowLedger): DimensionMeta | null {
  const resolved = new Set(ledger.exploration.resolvedDimensions);
  return EXPLORATION_DIMENSIONS.find((d) => !resolved.has(d.id)) ?? null;
}

export interface Convergence {
  canDiverge: boolean;
  resolved: ExplorationDimension[];
  missing: ExplorationDimension[];
  /** 人话进度，给用户/agent 看。 */
  summary: string;
}

/**
 * 信息够不够发散原型：所有关键维度都解决了才 canDiverge。
 * 这是建议性的收敛信号，配合 stage 机器一起保证「一句话需求不会直接进入生码」。
 */
export function convergence(ledger: FlowLedger): Convergence {
  const resolvedSet = new Set(ledger.exploration.resolvedDimensions);
  const resolved = REQUIRED_IDS.filter((id) => resolvedSet.has(id));
  const missing = REQUIRED_IDS.filter((id) => !resolvedSet.has(id));
  const canDiverge = missing.length === 0;
  const summary = canDiverge
    ? '关键维度已全部解决，可以发散 2-3 个原型方向。'
    : `还差 ${missing.length}/${REQUIRED_IDS.length} 个关键维度未解决：${missing.map(labelOf).join('、')}。`;
  return { canDiverge, resolved, missing, summary };
}

function labelOf(id: ExplorationDimension): string {
  return EXPLORATION_DIMENSIONS.find((d) => d.id === id)?.label ?? id;
}
