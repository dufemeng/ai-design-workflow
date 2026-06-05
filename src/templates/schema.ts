import { z } from 'zod';

/**
 * T2：模板 registry 的契约。任何模板源（内置、path、package）都必须提供一个
 * 符合 RegistryManifest 的 adw-registry.json，本系统才会用它——这样产品和某个
 * 具体模板库（如 html-anything）解耦，不硬编码本机路径。
 */

export const TemplateScenarioSchema = z.enum([
  'h5-single', // H5 单屏
  'h5-flow', // H5 多屏流程
  'web-proto', // Web 原型方向
  'prd-spec', // 需求说明 / PRD
  'eng-handoff', // 技术 / 实现交接
  'data-report', // 数据和验证报告（gap report 等）
]);
export type TemplateScenario = z.infer<typeof TemplateScenarioSchema>;

export const TemplateSurfaceSchema = z.enum(['h5', 'web', 'doc', 'report']);
export type TemplateSurface = z.infer<typeof TemplateSurfaceSchema>;

export const TemplateEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  scenario: TemplateScenarioSchema,
  surface: TemplateSurfaceSchema,
  description: z.string().min(1),
  /** 静态 HTML shell，相对 registry 根目录。可直接当静态文件打开，不依赖运行时服务。 */
  shellPath: z.string().min(1),
});
export type TemplateEntry = z.infer<typeof TemplateEntrySchema>;

export const RegistryManifestSchema = z.object({
  templates: z.array(TemplateEntrySchema).min(1),
});
export type RegistryManifest = z.infer<typeof RegistryManifestSchema>;

export const REGISTRY_MANIFEST_FILENAME = 'adw-registry.json';

/**
 * 场景 → 推荐模板 id（有序）。对应架构 5.4 与 tasks T2 的映射。
 * 单独维护而不是从 entry.scenario 反推，因为 h5-flow 会跨用 mobile-app。
 */
export const SCENARIO_RECOMMENDATIONS: Record<TemplateScenario, string[]> = {
  'h5-single': ['mobile-app'],
  'h5-flow': ['mobile-onboarding', 'mobile-app'],
  'web-proto': ['prototype-web'],
  'prd-spec': ['pm-spec'],
  'eng-handoff': ['eng-runbook', 'docs-page'],
  'data-report': ['data-report', 'dashboard'],
};
