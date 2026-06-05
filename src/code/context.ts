import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AdwConfig } from '../config/schema.js';
import { type DesignFlowSpec, parseDesignFlow } from '../design-flow/index.js';
import { FlowLedgerStore } from '../flow/index.js';

export class CodeContextError extends Error {
  constructor(
    message: string,
    readonly hint: string,
  ) {
    super(message);
    this.name = 'CodeContextError';
  }
}

/** T9：Code 工作台读取的全部上下文。目标 route 来自设计稿，不另起一套。 */
export interface CodeContext {
  slug: string;
  spec: DesignFlowSpec;
  targetRoute: string | null;
  designMdRel: string;
  designHtmlRel: string;
  designVersion: string | null;
  implementationTarget: { route: string; needsAuthedSession: boolean } | null;
}

/**
 * 组装 Code 工作台上下文。要求 flow 已在 code 阶段（审查门过 + approveDesign）。
 * 约束（文档级，由 T13 门禁与 gap 安全契约保证）：实现 agent 不直接改根 DESIGN.md；
 * gap 默认复用已登录浏览器会话，登录不归 gap loop 管。
 */
export function assembleCodeContext(targetDir: string, config: AdwConfig, slug: string): CodeContext {
  const ledger = new FlowLedgerStore(targetDir, config.artifactDir).read(slug);
  if (ledger.currentStage !== 'code') {
    throw new CodeContextError(`flow「${slug}」当前在「${ledger.currentStage}」，还没进入 Code 阶段。`, '先过设计稿审查门并 approveDesign。');
  }
  const mdRel = join(config.artifactDir, `design-${slug}.md`);
  const mdPath = join(targetDir, mdRel);
  if (!existsSync(mdPath)) {
    throw new CodeContextError(`缺少设计稿：${mdPath}`, '先 design:flow-generate 生成设计稿。');
  }
  const spec = parseDesignFlow(readFileSync(mdPath, 'utf8'));
  return {
    slug,
    spec,
    targetRoute: spec.targetRoute,
    designMdRel: mdRel,
    designHtmlRel: join(config.artifactDir, `design-${slug}.html`),
    designVersion: ledger.designVersion,
    implementationTarget: ledger.implementationTarget,
  };
}
