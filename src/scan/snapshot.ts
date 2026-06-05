import { z } from 'zod';

/** T3：项目上下文快照。扫描目标仓库后给出的事实，供冷启动 / 编排 / retrospective 消费。 */
export const ProjectContextSnapshotSchema = z.object({
  targetDir: z.string(),
  purpose: z.object({
    readmeTitle: z.string().nullable(),
    readmeSummary: z.string().nullable(),
    hasClaudeMd: z.boolean(),
    hasAgentsMd: z.boolean(),
  }),
  techStack: z.object({
    packageName: z.string().nullable(),
    isMonorepo: z.boolean(),
    packageManager: z.string().nullable(),
    startCommands: z.array(z.string()),
    frameworks: z.array(z.string()),
  }),
  designSignals: z.object({
    hasTailwind: z.boolean(),
    cssFileCount: z.number().int().nonnegative(),
    tokenFiles: z.array(z.string()),
    componentDirs: z.array(z.string()),
  }),
  designLanguage: z.object({
    hasDesignMd: z.boolean(),
    hasProductMd: z.boolean(),
    impeccable: z.object({
      present: z.boolean(),
      hasDesignJson: z.boolean(),
      critiqueCount: z.number().int().nonnegative(),
      hasLive: z.boolean(),
    }),
  }),
  designFlows: z.array(
    z.object({
      slug: z.string(),
      mdPath: z.string(),
      hasHtml: z.boolean(),
    }),
  ),
});
export type ProjectContextSnapshot = z.infer<typeof ProjectContextSnapshotSchema>;
