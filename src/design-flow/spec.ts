import { z } from 'zod';

/**
 * T7：需求级正式设计产物的机器可读 spec。
 * 写进 design-<flow>.md 的 YAML frontmatter，作为 T8 审查门 / T10 gap 的权威输入；
 * 正文是人读叙述。spec 只引用 DESIGN.md 的版本，不复制其全部内容。
 */

export const ScreenSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(''),
  /** agent 可选提供的屏幕 mock HTML，作为 gap baseline 的可视底座。 */
  mockHtml: z.string().optional(),
});
export type Screen = z.infer<typeof ScreenSchema>;

export const StateKindSchema = z.enum(['empty', 'loading', 'error', 'success', 'boundary']);
export type StateKind = z.infer<typeof StateKindSchema>;

const ScalarSchema = z.union([z.string(), z.number(), z.boolean()]);

export const DriverExpectationSchema = z.object({
  selector: z.string().min(1).optional(),
  text: z.string().min(1).optional(),
  urlIncludes: z.string().min(1).optional(),
});
export type DriverExpectation = z.infer<typeof DriverExpectationSchema>;

export const StateDriverSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('query-param'),
    params: z.record(ScalarSchema).default({}),
  }),
  z.object({
    type: z.literal('mock-response'),
    urlPattern: z.string().min(1),
    status: z.number().int().min(100).max(599).default(200),
    body: z.unknown().default({}),
    headers: z.record(z.string()).default({}),
  }),
  z.object({
    type: z.literal('fixture'),
    path: z.string().min(1),
    mode: z.enum(['query-param', 'mock-response']).default('query-param'),
    paramName: z.string().min(1).default('fixture'),
    urlPattern: z.string().optional(),
    status: z.number().int().min(100).max(599).default(200),
  }),
  z.object({
    type: z.literal('feature-flag'),
    flags: z.record(ScalarSchema).default({}),
    mode: z.enum(['query-param', 'local-storage']).default('query-param'),
  }),
  z.object({
    type: z.literal('seed-data'),
    description: z.string().min(1),
    params: z.record(z.unknown()).default({}),
  }),
  z.object({
    type: z.literal('test-hook'),
    hook: z.string().min(1),
    params: z.record(z.unknown()).default({}),
  }),
]);
export type StateDriver = z.infer<typeof StateDriverSchema>;

export const ScreenStateSchema = z.object({
  id: z.string().min(1),
  screenId: z.string().min(1),
  kind: StateKindSchema,
  description: z.string().default(''),
  driver: StateDriverSchema.optional(),
  expected: DriverExpectationSchema.optional(),
  notTestableReason: z.string().min(1).optional(),
});

export const InteractionStepSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('click'),
    selector: z.string().min(1),
  }),
  z.object({
    action: z.literal('input'),
    selector: z.string().min(1),
    value: z.string().default(''),
  }),
  z.object({
    action: z.literal('expand-collapse'),
    selector: z.string().min(1),
  }),
  z.object({
    action: z.literal('scroll'),
    selector: z.string().min(1).optional(),
    x: z.number().default(0),
    y: z.number().default(480),
  }),
  z.object({
    action: z.literal('keyboard'),
    key: z.string().min(1),
  }),
]);
export type InteractionStep = z.infer<typeof InteractionStepSchema>;

export const InteractionDriverSchema = z.object({
  steps: z.array(InteractionStepSchema).min(1),
  expected: DriverExpectationSchema.optional(),
});
export type InteractionDriver = z.infer<typeof InteractionDriverSchema>;

export const InteractionSpecSchema = z.object({
  id: z.string().min(1),
  screenId: z.string().optional(),
  description: z.string().min(1),
  driver: InteractionDriverSchema.optional(),
  notTestableReason: z.string().min(1).optional(),
});
export type InteractionSpec = z.infer<typeof InteractionSpecSchema>;

export const AcceptanceRuleSchema = z.object({
  id: z.string().min(1),
  rule: z.string().min(1),
  screenId: z.string().optional(),
  /** 怎么验：人话或可执行检查描述。 */
  check: z.string().default(''),
});

export const DeviationSchema = z.object({
  rule: z.string().min(1),
  /** 偏离根 DESIGN.md 必须给理由。 */
  reason: z.string().min(1),
});

export const H5ConstraintsSchema = z.object({
  safeArea: z.boolean().default(true),
  keyboard: z.boolean().default(false),
  bottomActionBar: z.boolean().default(false),
  tapTargetMinPx: z.number().int().positive().default(44),
});

export const DesignFlowSpecSchema = z
  .object({
    flow: z.string().min(1),
    title: z.string().min(1),
    background: z.string().default(''),
    goals: z.array(z.string()).default([]),
    users: z.string().default(''),
    scenario: z.string().default(''),
    selectedDirection: z.string().default(''),
    tradeoffs: z.array(z.string()).default([]),
    informationArchitecture: z.string().default(''),
    mainPath: z.string().default(''),
    screens: z.array(ScreenSchema).min(1),
    states: z.array(ScreenStateSchema).default([]),
    interactions: z.array(InteractionSpecSchema).default([]),
    targetRoute: z.string().nullable().default(null),
    h5Constraints: H5ConstraintsSchema.default({}),
    acceptanceRules: z.array(AcceptanceRuleSchema).default([]),
    designVersion: z.string().min(1),
    deviations: z.array(DeviationSchema).default([]),
  })
  .superRefine((spec, ctx) => {
    const screenIds = new Set(spec.screens.map((s) => s.id));
    for (const st of spec.states) {
      if (!screenIds.has(st.screenId)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['states'], message: `状态「${st.id}」引用了不存在的屏幕「${st.screenId}」` });
      }
      if (st.driver && st.notTestableReason) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['states'], message: `状态「${st.id}」不能同时声明 driver 和 notTestableReason` });
      }
    }
    for (const it of spec.interactions) {
      if (it.screenId && !screenIds.has(it.screenId)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['interactions'], message: `交互「${it.id}」引用了不存在的屏幕「${it.screenId}」` });
      }
      if (it.driver && it.notTestableReason) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['interactions'], message: `交互「${it.id}」不能同时声明 driver 和 notTestableReason` });
      }
    }
    for (const ar of spec.acceptanceRules) {
      if (ar.screenId && !screenIds.has(ar.screenId)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['acceptanceRules'], message: `验收「${ar.id}」引用了不存在的屏幕「${ar.screenId}」` });
      }
    }
  });
export type DesignFlowSpec = z.infer<typeof DesignFlowSpecSchema>;

export interface Readiness {
  ready: boolean;
  missing: string[];
}

/** 进入 Code 的准入：必须有机器可读状态清单（硬门），route 和验收也要齐。 */
export function readinessForCode(spec: DesignFlowSpec): Readiness {
  const missing: string[] = [];
  if (spec.states.length === 0) missing.push('机器可读状态清单');
  const statesWithoutDriver = spec.states.filter((s) => !s.driver && !s.notTestableReason);
  if (statesWithoutDriver.length > 0) missing.push(`状态驱动方式或 not-testable 理由：${statesWithoutDriver.map((s) => s.id).join(', ')}`);
  const interactionsWithoutDriver = spec.interactions.filter((i) => !i.driver && !i.notTestableReason);
  if (interactionsWithoutDriver.length > 0) missing.push(`交互驱动方式或 not-testable 理由：${interactionsWithoutDriver.map((i) => i.id).join(', ')}`);
  if (!spec.targetRoute) missing.push('目标 route');
  if (spec.acceptanceRules.length === 0) missing.push('验收规则');
  return { ready: missing.length === 0, missing };
}
