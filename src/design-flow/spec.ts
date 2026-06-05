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

export const ScreenStateSchema = z.object({
  id: z.string().min(1),
  screenId: z.string().min(1),
  kind: StateKindSchema,
  description: z.string().default(''),
});

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
  if (!spec.targetRoute) missing.push('目标 route');
  if (spec.acceptanceRules.length === 0) missing.push('验收规则');
  return { ready: missing.length === 0, missing };
}
