import { z } from 'zod';
import { JudgmentInputSchema } from '../review/index.js';

export const HandoffSkillSchema = z.enum(['document', 'critique', 'polish', 'audit', 'live']);
export type HandoffSkill = z.infer<typeof HandoffSkillSchema>;

export const AgentHarnessSchema = z.enum(['codex', 'claude-code', 'other']);

export const CommonImportResultSchema = z.object({
  source: z.literal('agent-skill'),
  skill: HandoffSkillSchema,
  agentHarness: AgentHarnessSchema,
  inputRefs: z.array(z.string()).default([]),
  outputRefs: z.array(z.string()).default([]),
  designVersion: z.string().nullable().default(null),
  confirmedBy: z.string().min(1),
});
export type CommonImportResult = z.infer<typeof CommonImportResultSchema>;

export const DocumentImportResultSchema = CommonImportResultSchema.extend({
  skill: z.literal('document'),
  designMdContent: z.string().min(1),
  sidecar: z.record(z.unknown()).nullable().default(null),
  tokensSummary: z
    .object({
      colors: z.record(z.string()).default({}),
      typography: z.record(z.unknown()).default({}),
    })
    .passthrough()
    .default({ colors: {}, typography: {} }),
});
export type DocumentImportResult = z.infer<typeof DocumentImportResultSchema>;

export const CritiqueImportResultSchema = CommonImportResultSchema.extend({
  skill: z.literal('critique'),
  findings: JudgmentInputSchema.shape.findings,
});
export type CritiqueImportResult = z.infer<typeof CritiqueImportResultSchema>;
