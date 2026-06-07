import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AdwConfig } from '../config/schema.js';
import { parseDesignMd } from '../design/index.js';
import { parseDesignFlow } from '../design-flow/index.js';
import { FlowLedgerStore } from '../flow/index.js';
import { formatImpeccableFinding, runImpeccableDetect, type ImpeccableDetectResult } from '../impeccable/index.js';
import { type DeterministicFinding, runDeterministicRules } from './deterministic.js';
import { evaluateJudgment, type JudgmentEvaluation, type JudgmentInput } from './judgment.js';

export class ReviewError extends Error {
  constructor(
    message: string,
    readonly hint: string,
  ) {
    super(message);
    this.name = 'ReviewError';
  }
}

export interface ReviewResult {
  passed: boolean;
  blockingReasons: string[];
  deterministicFindings: DeterministicFinding[];
  detector: ImpeccableDetectResult;
  judgment: JudgmentEvaluation;
  /** 参考分，不作为阻塞条件。 */
  score: number;
  reportPath: string;
}

const REVIEW_START = '<!-- ADW-REVIEW-START -->';
const REVIEW_END = '<!-- ADW-REVIEW-END -->';

function computeScore(det: DeterministicFinding[], jeval: JudgmentEvaluation): number {
  let s = 40;
  for (const d of det) s -= d.severity === 'block' ? 6 : 2;
  s -= jeval.blocking.length * 8;
  s -= jeval.fatalWithoutEvidence.length * 1;
  s -= jeval.advisory.length * 1;
  return Math.max(0, s);
}

function detectorFindings(result: ImpeccableDetectResult): DeterministicFinding[] {
  if (!result.ok) {
    return [
      {
        rule: 'detector',
        severity: 'block',
        message: `Impeccable detect 未完成：${result.message}`,
        evidence: result.command ?? undefined,
      },
    ];
  }
  return result.findings.map((f) => ({
    rule: `detector:${f.antipattern}`,
    severity: f.severity === 'advisory' ? 'advisory' : 'block',
    message: formatImpeccableFinding(f),
    evidence: result.command,
  }));
}

/**
 * 审查门：确定性层 + 判断层。过线 = 确定性无 block 且 判断层无「带证据的致命问题」。
 * 分数只参考。结论写回 design-<flow>.md 和 Flow Ledger。
 */
export function runReviewGate(targetDir: string, config: AdwConfig, slug: string, judgment: JudgmentInput): ReviewResult {
  const mdPath = join(targetDir, config.artifactDir, `design-${slug}.md`);
  const htmlPath = join(targetDir, config.artifactDir, `design-${slug}.html`);
  if (!existsSync(mdPath) || !existsSync(htmlPath)) {
    throw new ReviewError(`找不到设计稿产物：${mdPath} / ${htmlPath}`, '先 design:flow-generate 生成设计稿。');
  }
  const mdContent = readFileSync(mdPath, 'utf8');
  const spec = parseDesignFlow(mdContent);
  const html = readFileSync(htmlPath, 'utf8');

  let palette: string[] | null = null;
  const designMdPath = join(targetDir, config.designMdPath);
  if (existsSync(designMdPath)) {
    palette = Object.values(parseDesignMd(readFileSync(designMdPath, 'utf8')).tokens.colors);
  }

  const detector = runImpeccableDetect(htmlPath, { cwd: targetDir });
  const deterministicFindings = [...runDeterministicRules(html, spec, palette), ...detectorFindings(detector)];
  const detBlock = deterministicFindings.filter((d) => d.severity === 'block');
  const jeval = evaluateJudgment(judgment);

  const blockingReasons = [
    ...detBlock.map((d) => `[确定性/${d.rule}] ${d.message}`),
    ...jeval.blocking.map((j) => `[判断/${j.dimension}] ${j.message}`),
  ];
  const passed = blockingReasons.length === 0;
  const score = computeScore(deterministicFindings, jeval);

  const reportPath = join(targetDir, config.artifactDir, 'assets', slug, 'design-review.json');
  writeJson(reportPath, { slug, passed, score, blockingReasons, deterministicFindings, detector, judgment: jeval, at: new Date().toISOString() });

  appendConclusion(mdPath, mdContent, passed, score, blockingReasons);

  // 写回 ledger（runDesignReview 要求已在 design 阶段且 attach 过设计稿）。
  new FlowLedgerStore(targetDir, config.artifactDir).apply(slug, { type: 'runDesignReview', passed, blockingReasons });

  return { passed, blockingReasons, deterministicFindings, detector, judgment: jeval, score, reportPath };
}

function appendConclusion(mdPath: string, mdContent: string, passed: boolean, score: number, reasons: string[]): void {
  const lines = [
    REVIEW_START,
    '## 设计评审结论',
    `- 结果：${passed ? '通过' : '阻塞'}`,
    `- 参考分：${score}/40（分数不作为唯一阻塞条件）`,
    ...reasons.map((r) => `- 阻塞：${r}`),
    REVIEW_END,
  ].join('\n');

  let next: string;
  const startIdx = mdContent.indexOf(REVIEW_START);
  if (startIdx >= 0) {
    const endIdx = mdContent.indexOf(REVIEW_END);
    const tail = endIdx >= 0 ? mdContent.slice(endIdx + REVIEW_END.length) : '';
    next = `${mdContent.slice(0, startIdx)}${lines}${tail}`;
  } else {
    next = `${mdContent.trimEnd()}\n\n${lines}\n`;
  }
  writeFileSync(mdPath, next, 'utf8');
}

function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}
