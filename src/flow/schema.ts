import { z } from 'zod';

/**
 * T1：FlowRun 状态机和产物台账（design-<flow>.workflow.json）。
 * 字段对应 tasks-ai-design-workflow-system-mvp.md 5.2。
 * 这张表是一条需求 flow 的唯一权威状态，保证中断 / 续跑 / 复盘。
 */

export const FlowStageSchema = z.enum(['proposal', 'design', 'code', 'done']);
export type FlowStage = z.infer<typeof FlowStageSchema>;

/** 当前阻塞门禁。done 时为 null。 */
export const FlowGateSchema = z.enum([
  'prototype-selection',
  'design-review',
  'gap-blocking-check',
  'live-review',
]);
export type FlowGate = z.infer<typeof FlowGateSchema>;

/** Proposal 探索循环要解决的关键维度（架构 7 的收敛条件）。 */
export const ExplorationDimensionSchema = z.enum([
  'target-user',
  'core-scenario',
  'main-path',
  'key-states',
  'constraints',
  'success-criteria',
]);
export type ExplorationDimension = z.infer<typeof ExplorationDimensionSchema>;

/** Proposal 探索循环的累积状态。收敛按维度判定，不按固定轮数。 */
export const ExplorationSchema = z.object({
  assumptions: z.array(z.string()).default([]),
  decisions: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
  resolvedDimensions: z.array(ExplorationDimensionSchema).default([]),
});

/** 产物台账：所有路径相对目标项目根目录。 */
export const ArtifactRefsSchema = z.object({
  prototypeHtml: z.array(z.string()).default([]),
  designMd: z.string().nullable().default(null),
  designHtml: z.string().nullable().default(null),
  /** 每轮 gap report 单独留档，不互相覆盖。 */
  gapReports: z.array(z.string()).default([]),
  patches: z.array(z.string()).default([]),
});

export const ReviewStatusSchema = z.object({
  state: z.enum(['not-run', 'blocked', 'passed']).default('not-run'),
  blockingReasons: z.array(z.string()).default([]),
  ranAt: z.string().nullable().default(null),
});

export const GapRoundSchema = z.object({
  round: z.number().int().nonnegative(),
  reportRef: z.string(),
  blockingCount: z.number().int().nonnegative(),
  warningCount: z.number().int().nonnegative(),
  autoFixApplied: z.boolean().default(false),
  at: z.string(),
});
export type GapRound = z.infer<typeof GapRoundSchema>;

export const PatchIntentSchema = z.object({
  source: z.enum(['auto-fix', 'live']),
  purpose: z.string(),
  scope: z.string(),
  relatedRule: z.string().nullable().default(null),
  needsReverify: z.boolean(),
  at: z.string(),
  /** live 指标（T12）：耗时与结果，自动修复可不填。 */
  durationMs: z.number().nonnegative().nullable().default(null),
  result: z.enum(['accepted', 'rejected', 'abandoned']).nullable().default(null),
});
export type PatchIntent = z.infer<typeof PatchIntentSchema>;

export const ImplementationTargetSchema = z.object({
  route: z.string(),
  needsAuthedSession: z.boolean(),
});

export const FlowEventSchema = z.object({
  seq: z.number().int().nonnegative(),
  action: z.string(),
  at: z.string(),
  summary: z.string(),
});
export type FlowEvent = z.infer<typeof FlowEventSchema>;

/** 中断后下一步能做什么（人话 + 允许的 action）。 */
export const ResumePointerSchema = z.object({
  nextActions: z.array(z.string()),
  hint: z.string(),
});

export const FlowLedgerSchema = z.object({
  schemaVersion: z.literal(1),
  flowId: z.string().min(1),
  slug: z.string().min(1),
  title: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  currentStage: FlowStageSchema,
  currentGate: FlowGateSchema.nullable(),
  designVersion: z.string().nullable().default(null),
  exploration: ExplorationSchema,
  artifactRefs: ArtifactRefsSchema,
  reviewStatus: ReviewStatusSchema,
  gapHistory: z.array(GapRoundSchema).default([]),
  patchIntentHistory: z.array(PatchIntentSchema).default([]),
  implementationTarget: ImplementationTargetSchema.nullable().default(null),
  resumePointer: ResumePointerSchema,
  eventLog: z.array(FlowEventSchema).default([]),
});
export type FlowLedger = z.infer<typeof FlowLedgerSchema>;
