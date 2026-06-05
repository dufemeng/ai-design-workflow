import { z } from 'zod';

/**
 * T8 判断层。结论由 agent（LLM）产出；本模块只强制「契约」：
 * 致命意见必须绑定证据（屏幕/元素/文本/交互）才能阻塞——没证据的致命意见一律不算数。
 * 这正是审查门可信契约里「判断层只判机器判不了的那一件事 + 每条结论必须挂实锤」。
 */

export const JudgmentEvidenceSchema = z.object({
  screen: z.string().optional(),
  element: z.string().optional(),
  text: z.string().optional(),
  interaction: z.string().optional(),
});

export const JudgmentFindingSchema = z.object({
  dimension: z.enum(['ia', 'main-path', 'product-thesis', 'copy', 'state']),
  severity: z.enum(['fatal', 'advisory']),
  message: z.string().min(1),
  evidence: JudgmentEvidenceSchema.default({}),
});
export type JudgmentFinding = z.infer<typeof JudgmentFindingSchema>;

export const JudgmentInputSchema = z.object({ findings: z.array(JudgmentFindingSchema).default([]) });
export type JudgmentInput = z.infer<typeof JudgmentInputSchema>;

function hasEvidence(f: JudgmentFinding): boolean {
  return Boolean(f.evidence.screen || f.evidence.element || f.evidence.text || f.evidence.interaction);
}

export interface JudgmentEvaluation {
  /** 带证据的致命问题——这些才阻塞。 */
  blocking: JudgmentFinding[];
  /** 致命但没证据——不算数，但回报出来提醒补证据。 */
  fatalWithoutEvidence: JudgmentFinding[];
  advisory: JudgmentFinding[];
}

export function evaluateJudgment(input: JudgmentInput): JudgmentEvaluation {
  const blocking: JudgmentFinding[] = [];
  const fatalWithoutEvidence: JudgmentFinding[] = [];
  const advisory: JudgmentFinding[] = [];
  for (const fnd of input.findings) {
    if (fnd.severity === 'fatal') {
      if (hasEvidence(fnd)) blocking.push(fnd);
      else fatalWithoutEvidence.push(fnd);
    } else {
      advisory.push(fnd);
    }
  }
  return { blocking, fatalWithoutEvidence, advisory };
}
