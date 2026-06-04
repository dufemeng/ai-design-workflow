import { z } from 'zod';

/**
 * T0：配置和 artifact 协议的 schema。
 * 字段对应 tasks-ai-design-workflow-system-mvp.md 的 T0 交付清单。
 */

/** gap 检查维度。阻塞 vs 提醒的归属由 config 决定，但维度名固定。 */
export const GapCheckSchema = z.enum(['token', 'state', 'dom', 'detector', 'interaction', 'a11y']);
export type GapCheck = z.infer<typeof GapCheckSchema>;

export const ViewportSchema = z.object({
  name: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type Viewport = z.infer<typeof ViewportSchema>;

/** 低于这个宽度算 H5 移动端 viewport。 */
export const MOBILE_VIEWPORT_MAX_WIDTH = 480;

const DEFAULT_MOBILE_VIEWPORT: Viewport = { name: 'iphone-15-pro', width: 393, height: 852 };

export const TemplateRegistrySchema = z.object({
  /** path：相对目标项目的路径；package：可解析的 package id。 */
  type: z.enum(['path', 'package']),
  value: z.string().min(1),
});
export type TemplateRegistry = z.infer<typeof TemplateRegistrySchema>;

export const GapConfigSchema = z.object({
  blockingChecks: z.array(GapCheckSchema).default(['token', 'state', 'dom', 'detector']),
  warningChecks: z.array(GapCheckSchema).default(['interaction', 'a11y']),
  maxAutoFixRounds: z.number().int().min(1).max(10).default(3),
});
export type GapConfig = z.infer<typeof GapConfigSchema>;

export const ConfigSchema = z
  .object({
    artifactDir: z.string().min(1).default('docs'),
    designMdPath: z.string().min(1).default('DESIGN.md'),
    productContextMode: z.enum(['product-md-compatible']).default('product-md-compatible'),
    templateRegistry: TemplateRegistrySchema.default({ type: 'package', value: 'html-anything' }),
    defaultViewports: z.array(ViewportSchema).min(1).default([DEFAULT_MOBILE_VIEWPORT]),
    gap: GapConfigSchema.default({}),
  })
  .superRefine((cfg, ctx) => {
    // T0 验收：defaultViewports 至少包含一个 H5 移动端 viewport。
    if (!cfg.defaultViewports.some((v) => v.width <= MOBILE_VIEWPORT_MAX_WIDTH)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['defaultViewports'],
        message: `必须至少包含一个 H5 移动端 viewport（width <= ${MOBILE_VIEWPORT_MAX_WIDTH}）；当前没有任何移动端宽度。`,
      });
    }
    // 同一个检查不能既阻塞又提醒，否则 gap 判定语义矛盾。
    const overlap = cfg.gap.blockingChecks.filter((c) => cfg.gap.warningChecks.includes(c));
    if (overlap.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['gap'],
        message: `同一个检查不能同时是阻塞和提醒：${overlap.join(', ')}`,
      });
    }
  });

export type AdwConfig = z.infer<typeof ConfigSchema>;

/** 全默认配置。用于「目标项目没有 config 文件」时回退。 */
export const DEFAULT_CONFIG: AdwConfig = ConfigSchema.parse({});
