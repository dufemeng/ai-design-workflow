import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AdwConfig } from '../config/schema.js';
import { renderConfirmationHtml } from './confirmation.js';
import { computeDesignVersion, parseDesignMd } from './designmd.js';
import { extractColorSeeds } from './extract.js';

const DRAFT_MARKER = '<!-- ADW DRAFT：确认前不要当作权威 DESIGN.md，先看确认页再 design:confirm -->';

export type BootstrapAction = 'review' | 'seed-draft' | 'refresh-draft';

export interface BootstrapResult {
  action: BootstrapAction;
  designMdPath: string;
  draftPath: string | null;
  confirmationPath: string;
  designVersion: string | null;
  notes: string[];
}

export class DesignBootstrapError extends Error {
  constructor(
    message: string,
    readonly hint: string,
  ) {
    super(message);
    this.name = 'DesignBootstrapError';
  }
}

/**
 * 冷启动 / 评审 DESIGN.md。硬规则：本函数永不写最终 DESIGN.md——
 * 已存在则只生成确认页；需要新建/刷新则写 .draft + 确认页，等 design:confirm 才落地。
 */
export function bootstrapDesignLanguage(targetDir: string, config: AdwConfig, opts: { refresh?: boolean } = {}): BootstrapResult {
  const designMdPath = join(targetDir, config.designMdPath);
  const confirmationPath = join(targetDir, config.artifactDir, 'design-system-confirmation.html');
  const draftPath = `${designMdPath}.draft`;
  const notes: string[] = [];

  if (existsSync(designMdPath)) {
    const content = readFileSync(designMdPath, 'utf8');
    const parsed = parseDesignMd(content);
    const designVersion = computeDesignVersion(content);

    if (!opts.refresh) {
      write(confirmationPath, renderConfirmationHtml(parsed, { isDraft: false, designVersion, sourceNote: `现有 ${config.designMdPath}` }));
      notes.push(`${config.designMdPath} 已存在，未改动；已生成确认页供评审。`);
      return { action: 'review', designMdPath, draftPath: null, confirmationPath, designVersion, notes };
    }

    const draftContent = `${DRAFT_MARKER}\n${content}`;
    write(draftPath, draftContent);
    write(confirmationPath, renderConfirmationHtml(parseDesignMd(draftContent), { isDraft: true, designVersion: null, sourceNote: `从现有 ${config.designMdPath} 复制供编辑` }));
    notes.push(`refresh：已写 ${config.designMdPath}.draft，未改动 ${config.designMdPath}；改完草稿后 design:confirm 才生效。`);
    return { action: 'refresh-draft', designMdPath, draftPath, confirmationPath, designVersion: null, notes };
  }

  const seeds = extractColorSeeds(targetDir);
  const draftContent = buildSeedDraft(seeds);
  write(draftPath, draftContent);
  write(confirmationPath, renderConfirmationHtml(parseDesignMd(draftContent), { isDraft: true, designVersion: null, sourceNote: `代码扫描种子（${Object.keys(seeds).length} 个候选颜色）` }));
  notes.push(`${config.designMdPath} 缺失：已生成 DRAFT 种子（含 ${Object.keys(seeds).length} 个候选颜色），需 agent 执行 Impeccable /document 或人工补全后 design:confirm。`);
  return { action: 'seed-draft', designMdPath, draftPath, confirmationPath, designVersion: null, notes };
}

/** 用户确认：把 .draft 提升为最终 DESIGN.md。这是唯一会写根 DESIGN.md 的入口。 */
export function confirmDesignLanguage(targetDir: string, config: AdwConfig): { designMdPath: string; designVersion: string } {
  const designMdPath = join(targetDir, config.designMdPath);
  const draftPath = `${designMdPath}.draft`;
  if (!existsSync(draftPath)) {
    throw new DesignBootstrapError(`没有待确认的草稿：${draftPath}`, '先用 design:bootstrap 生成草稿。');
  }
  const draft = readFileSync(draftPath, 'utf8');
  const finalContent = draft
    .split('\n')
    .filter((l) => !l.includes('ADW DRAFT'))
    .join('\n')
    .replace(/^\n+/, '');
  write(designMdPath, finalContent);
  return { designMdPath, designVersion: computeDesignVersion(finalContent) };
}

function buildSeedDraft(seeds: Record<string, string>): string {
  const colorLines = Object.entries(seeds)
    .map(([k, v]) => `  ${k}: "${v}"`)
    .join('\n');
  return `${DRAFT_MARKER}
---
name: 待填写产品名
description: 待填写产品调性（一句话）
colors:
${colorLines || '  primary: "#000000"'}
typography:
  display:
    fontFamily: "system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 600
---

# Design System（DRAFT 种子）

## 1. Overview
TODO：产品视觉方向。本草稿由扫描种子生成，需 agent 执行 Impeccable /document 或人工补全。

## 2. Colors
上方 frontmatter 的颜色来自代码扫描候选，需人工命名与取舍。

## 3. Typography
TODO：字体层级。

## 4. Elevation
TODO：阴影 / 层级。

## 5. Components
TODO：按钮、输入、卡片、导航等组件语义。

## 6. Do's and Don'ts
TODO。
`;
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
}
