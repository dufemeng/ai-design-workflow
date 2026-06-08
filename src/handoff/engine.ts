import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { AdwConfig } from '../config/index.js';
import { computeDesignVersion, parseDesignMd, renderConfirmationHtml, validateDesignMdForImport } from '../design/index.js';
import { FlowLedgerStore, type FlowLedger } from '../flow/index.js';
import { runReviewGate } from '../review/index.js';
import { CommonImportResultSchema, CritiqueImportResultSchema, DocumentImportResultSchema, HandoffSkillSchema, type HandoffSkill } from './schema.js';

export class HandoffError extends Error {
  constructor(
    message: string,
    readonly hint: string,
  ) {
    super(message);
    this.name = 'HandoffError';
  }
}

export interface HandoffContext {
  schemaVersion: 1;
  runId: string;
  skill: HandoffSkill;
  flowId: string;
  slug: string;
  title: string;
  stage: FlowLedger['currentStage'];
  gate: FlowLedger['currentGate'];
  designVersion: string | null;
  inputRefs: Record<string, string | string[] | null>;
  expectedOutputSchema: Record<string, unknown>;
  createdAt: string;
}

export interface HandoffResult {
  context: HandoffContext;
  contextRel: string;
  contextPath: string;
}

export interface ImportResult {
  skill: HandoffSkill;
  writtenRefs: string[];
  message: string;
}

export function createSkillHandoff(targetDir: string, config: AdwConfig, slug: string, skillRaw: string): HandoffResult {
  const skill = parseSkill(skillRaw);
  const ledger = new FlowLedgerStore(targetDir, config.artifactDir).read(slug);
  const runId = runIdNow();
  const context: HandoffContext = {
    schemaVersion: 1,
    runId,
    skill,
    flowId: ledger.flowId,
    slug: ledger.slug,
    title: ledger.title,
    stage: ledger.currentStage,
    gate: ledger.currentGate,
    designVersion: currentDesignVersion(targetDir, config, ledger),
    inputRefs: inputRefs(config, ledger),
    expectedOutputSchema: expectedSchema(skill),
    createdAt: new Date().toISOString(),
  };

  const contextRel = join(config.artifactDir, 'assets', slug, `handoff-${skill}-${runId}.json`);
  const contextPath = join(targetDir, contextRel);
  writeJson(contextPath, context);
  return { context, contextRel, contextPath };
}

export function importSkillResult(targetDir: string, config: AdwConfig, slug: string, resultPath: string): ImportResult {
  const raw = JSON.parse(readFileSync(resultPath, 'utf8')) as unknown;
  const common = CommonImportResultSchema.parse(raw);
  const skill = common.skill;
  const ledger = new FlowLedgerStore(targetDir, config.artifactDir).read(slug);
  verifyDesignVersion(ledger, common.designVersion);

  switch (skill) {
    case 'document':
      return importDocumentResult(targetDir, config, slug, raw);
    case 'critique':
      return importCritiqueResult(targetDir, config, slug, raw);
    case 'polish':
    case 'audit':
    case 'live':
      return importGenericResult(targetDir, config, slug, skill, raw);
  }
}

function importDocumentResult(targetDir: string, config: AdwConfig, slug: string, raw: unknown): ImportResult {
  const parsed = DocumentImportResultSchema.parse(raw);
  const validation = validateDesignMdForImport(parsed.designMdContent);
  if (!validation.valid) {
    throw new HandoffError('导入的 DESIGN.md 不符合格式要求。', `缺失：${validation.missing.join('、')}`);
  }

  const designMdPath = join(targetDir, config.designMdPath);
  const draftPath = `${designMdPath}.draft`;
  const confirmationPath = join(targetDir, config.artifactDir, 'design-system-confirmation.html');
  const runId = runIdNow();
  const importRel = join(config.artifactDir, 'assets', slug, `import-document-${runId}.json`);
  const sidecarRel = parsed.sidecar ? join(config.artifactDir, 'assets', slug, `document-sidecar-${runId}.json`) : null;

  writeFile(draftPath, parsed.designMdContent);
  writeFile(
    confirmationPath,
    renderConfirmationHtml(parseDesignMd(parsed.designMdContent), {
      isDraft: true,
      designVersion: null,
      sourceNote: `agent /document import (${parsed.agentHarness})`,
    }),
  );
  writeJson(join(targetDir, importRel), {
    source: parsed.source,
    skill: parsed.skill,
    agentHarness: parsed.agentHarness,
    inputRefs: parsed.inputRefs,
    outputRefs: parsed.outputRefs,
    designVersion: parsed.designVersion,
    confirmedBy: parsed.confirmedBy,
    importedAt: new Date().toISOString(),
    draftPath: config.designMdPath + '.draft',
    confirmationPath: join(config.artifactDir, 'design-system-confirmation.html'),
    tokensSummary: parsed.tokensSummary,
    nextAction: 'adw design:confirm',
  });
  if (parsed.sidecar && sidecarRel) writeJson(join(targetDir, sidecarRel), parsed.sidecar);

  return {
    skill: 'document',
    writtenRefs: [config.designMdPath + '.draft', join(config.artifactDir, 'design-system-confirmation.html'), importRel, ...(sidecarRel ? [sidecarRel] : [])],
    message: '已导入 /document 结果为 DESIGN.md.draft；确认后运行 design:confirm 写入根 DESIGN.md。',
  };
}

function importCritiqueResult(targetDir: string, config: AdwConfig, slug: string, raw: unknown): ImportResult {
  const parsed = CritiqueImportResultSchema.parse(raw);
  const result = runReviewGate(targetDir, config, slug, { findings: parsed.findings });
  const report = JSON.parse(readFileSync(result.reportPath, 'utf8')) as Record<string, unknown>;
  report.importedCritique = {
    source: parsed.source,
    skill: parsed.skill,
    agentHarness: parsed.agentHarness,
    inputRefs: parsed.inputRefs,
    outputRefs: parsed.outputRefs,
    designVersion: parsed.designVersion,
    confirmedBy: parsed.confirmedBy,
    importedAt: new Date().toISOString(),
  };
  writeJson(result.reportPath, report);
  return {
    skill: 'critique',
    writtenRefs: [join(config.artifactDir, 'assets', slug, 'design-review.json')],
    message: `已导入 /critique 结果并重跑设计审查门：${result.passed ? '通过' : '阻塞'}。`,
  };
}

function importGenericResult(targetDir: string, config: AdwConfig, slug: string, skill: HandoffSkill, raw: unknown): ImportResult {
  const parsed = CommonImportResultSchema.parse(raw);
  const runId = runIdNow();
  const rel = join(config.artifactDir, 'assets', slug, `import-${skill}-${runId}.json`);
  writeJson(join(targetDir, rel), { ...parsed, importedAt: new Date().toISOString() });
  return {
    skill,
    writtenRefs: [rel],
    message: `已记录 /${skill} 导入结果。该 skill 的专用写回 schema 尚未启用。`,
  };
}

function parseSkill(skill: string): HandoffSkill {
  const parsed = HandoffSkillSchema.safeParse(skill);
  if (!parsed.success) {
    throw new HandoffError(`不支持的 skill：${skill}`, '支持：document / critique / polish / audit / live。');
  }
  return parsed.data;
}

function verifyDesignVersion(ledger: FlowLedger, importedVersion: string | null): void {
  if (ledger.designVersion && importedVersion && ledger.designVersion !== importedVersion) {
    throw new HandoffError(
      '导入结果使用的 DESIGN.md 版本与当前 flow 不一致。',
      `导入=${importedVersion}，当前=${ledger.designVersion}。请重新 handoff 或确认是否需要刷新设计产物。`,
    );
  }
}

function currentDesignVersion(targetDir: string, config: AdwConfig, ledger: FlowLedger): string | null {
  if (ledger.designVersion) return ledger.designVersion;
  const designPath = join(targetDir, config.designMdPath);
  if (!existsSync(designPath)) return null;
  return computeDesignVersion(readFileSync(designPath, 'utf8'));
}

function inputRefs(config: AdwConfig, ledger: FlowLedger): Record<string, string | string[] | null> {
  return {
    workflow: join(config.artifactDir, `design-${ledger.slug}.workflow.json`),
    designMd: ledger.artifactRefs.designMd,
    designHtml: ledger.artifactRefs.designHtml,
    prototypeHtml: ledger.artifactRefs.prototypeHtml,
    gapReports: ledger.artifactRefs.gapReports,
    targetRoute: ledger.implementationTarget?.route ?? null,
  };
}

function expectedSchema(skill: HandoffSkill): Record<string, unknown> {
  const common = {
    source: 'agent-skill',
    skill,
    agentHarness: 'codex | claude-code | other',
    inputRefs: 'string[]',
    outputRefs: 'string[]',
    designVersion: 'string | null',
    confirmedBy: 'string',
  };
  if (skill === 'document') {
    return {
      ...common,
      designMdContent: 'complete Google DESIGN.md content',
      sidecar: 'object | null',
      tokensSummary: '{ colors, typography, ... }',
    };
  }
  if (skill === 'critique') {
    return {
      ...common,
      findings: [
        {
          dimension: 'ia | main-path | product-thesis | copy | state',
          severity: 'fatal | advisory',
          message: 'string',
          evidence: '{ screen?, element?, text?, interaction? }',
        },
      ],
    };
  }
  return common;
}

function runIdNow(): string {
  return new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
}

function writeJson(path: string, value: unknown): void {
  writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeFile(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value, 'utf8');
}

export const ImportResultSchema = z.object({
  skill: HandoffSkillSchema,
  writtenRefs: z.array(z.string()),
  message: z.string(),
});
