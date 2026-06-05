import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { stringify as yamlStringify } from 'yaml';
import { z } from 'zod';
import type { AdwConfig } from '../config/schema.js';
import { computeDesignVersion, parseDesignMd } from './designmd.js';

/**
 * T13：DESIGN.md 更新门禁。
 * 硬约束：agent 只能生成 delta proposal，绝不后台静默写 DESIGN.md；
 * 必须当前操作者显式 confirm 才落地。每个 delta 带 provenance + 前后差异 + 可视化确认页。
 */

export class DesignDeltaError extends Error {
  constructor(
    message: string,
    readonly hint: string,
  ) {
    super(message);
    this.name = 'DesignDeltaError';
  }
}

export const DesignDeltaInputSchema = z
  .object({
    id: z.string().min(1),
    reason: z.string().min(1), // 为什么要动全局设计语言（对应 9.3 更新门禁触发条件）
    provenance: z
      .object({
        flow: z.string().nullable().default(null),
        review: z.string().nullable().default(null),
        gapReport: z.string().nullable().default(null),
        codeScan: z.string().nullable().default(null),
      })
      .default({}),
    colorChanges: z.array(z.object({ key: z.string().min(1), to: z.string().min(1) })).default([]),
    affectedComponents: z.array(z.string()).default([]),
    affectedRules: z.array(z.string()).default([]),
  })
  .refine((d) => d.colorChanges.length > 0 || d.affectedComponents.length > 0 || d.affectedRules.length > 0, {
    message: '空 delta 不允许：至少要有一处颜色 / 组件 / 规则变更。',
  });
export type DesignDeltaInput = z.infer<typeof DesignDeltaInputSchema>;

interface DeltaProposal extends Omit<DesignDeltaInput, 'colorChanges'> {
  createdAt: string;
  colorChanges: { key: string; from: string | null; to: string }[];
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
}

function deltaDir(targetDir: string, config: AdwConfig): string {
  return join(targetDir, config.artifactDir, 'assets', '_design-delta');
}

function renderDeltaHtml(p: DeltaProposal): string {
  const prov = Object.entries(p.provenance)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${esc(String(v))}`)
    .join(' · ');
  const swatches = p.colorChanges
    .map(
      (c) => `<div class="row"><code>${esc(c.key)}</code>
        <span class="chip" style="background:${esc(c.from ?? 'transparent')}"></span><small>${esc(c.from ?? '（新增）')}</small>
        <span class="arr">→</span>
        <span class="chip" style="background:${esc(c.to)}"></span><small>${esc(c.to)}</small></div>`,
    )
    .join('\n');
  return `<!doctype html>
<html lang="zh-CN" data-adw-page="design-delta" data-delta="${esc(p.id)}">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>DESIGN.md 变更确认 · ${esc(p.id)}</title>
<style>
  body { margin:0; font-family:Inter,"PingFang SC",system-ui,sans-serif; color:#1f2328; background:#fafafa; }
  main { max-width:760px; margin:0 auto; padding:40px 24px; }
  .warn { background:#fff8c5; border:1px solid #d4a72c; padding:10px 14px; border-radius:6px; margin-bottom:16px; font-size:14px; }
  .row { display:flex; align-items:center; gap:8px; background:#fff; border:1px solid #eaecef; border-radius:6px; padding:8px 10px; margin:6px 0; }
  .chip { width:24px; height:24px; border-radius:5px; border:1px solid rgba(0,0,0,.1); }
  .arr { color:#8c959f; } small { color:#57606a; }
  .meta { color:#57606a; font-size:13px; margin:12px 0; }
</style></head>
<body><main>
  <div class="warn">⚠ 这是 DESIGN.md 变更<b>提案</b>，确认前不会改根 DESIGN.md。确认请跑 <code>adw designmd:confirm-delta</code>。</div>
  <h1>DESIGN.md 变更：${esc(p.id)}</h1>
  <div class="meta">理由：${esc(p.reason)}</div>
  <div class="meta">来源 provenance：${prov || '（未注明）'}</div>
  <h2>颜色 token 变更</h2>
  ${swatches || '<p>（无颜色变更）</p>'}
  <h2>影响范围</h2>
  <div class="meta">组件：${p.affectedComponents.map(esc).join('、') || '—'}<br/>规则：${p.affectedRules.map(esc).join('、') || '—'}</div>
</main></body></html>
`;
}

export interface ProposeResult {
  proposalPath: string;
  confirmationPath: string;
}

export function proposeDesignDelta(targetDir: string, config: AdwConfig, input: DesignDeltaInput): ProposeResult {
  const designMdPath = join(targetDir, config.designMdPath);
  if (!existsSync(designMdPath)) {
    throw new DesignDeltaError(`没有 DESIGN.md：${designMdPath}`, '先 design:bootstrap + design:confirm 建立全局设计语言。');
  }
  const current = parseDesignMd(readFileSync(designMdPath, 'utf8')).tokens.colors;
  const proposal: DeltaProposal = {
    id: input.id,
    reason: input.reason,
    provenance: input.provenance,
    affectedComponents: input.affectedComponents,
    affectedRules: input.affectedRules,
    createdAt: new Date().toISOString(),
    colorChanges: input.colorChanges.map((c) => ({ key: c.key, from: current[c.key] ?? null, to: c.to })),
  };

  const dir = deltaDir(targetDir, config);
  const proposalPath = join(dir, `${input.id}.json`);
  const confirmationPath = join(dir, `${input.id}.html`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(proposalPath, `${JSON.stringify(proposal, null, 2)}\n`, 'utf8');
  writeFileSync(confirmationPath, renderDeltaHtml(proposal), 'utf8');
  return { proposalPath, confirmationPath };
}

export interface ConfirmResult {
  designMdPath: string;
  designVersion: string;
}

/** 唯一会写根 DESIGN.md 的入口（delta 路径）。把已确认的 delta 合并进 frontmatter。 */
export function confirmDesignDelta(targetDir: string, config: AdwConfig, id: string): ConfirmResult {
  const proposalPath = join(deltaDir(targetDir, config), `${id}.json`);
  if (!existsSync(proposalPath)) {
    throw new DesignDeltaError(`找不到 delta 提案：${proposalPath}`, '先 designmd:propose-delta 生成提案。');
  }
  const proposal = JSON.parse(readFileSync(proposalPath, 'utf8')) as DeltaProposal;
  const designMdPath = join(targetDir, config.designMdPath);
  const content = readFileSync(designMdPath, 'utf8');
  const m = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw new DesignDeltaError('DESIGN.md 没有 frontmatter，无法合并 delta。', '检查 DESIGN.md 是 Google 格式。');

  const parsed = parseDesignMd(content);
  const raw = { ...parsed.tokens.raw } as Record<string, unknown>;
  const colors = { ...(raw.colors as Record<string, string> | undefined) };
  for (const c of proposal.colorChanges) colors[c.key] = c.to;
  raw.colors = colors;

  const body = m[2] ?? '';
  const next = `---\n${yamlStringify(raw)}---\n${body}`;
  writeFileSync(designMdPath, next, 'utf8');
  const designVersion = computeDesignVersion(next);

  // provenance 落档（sidecar 更新 MVP 暂缓）。
  const appliedPath = join(deltaDir(targetDir, config), `${id}.applied.json`);
  writeFileSync(appliedPath, `${JSON.stringify({ id, appliedAt: new Date().toISOString(), designVersion, provenance: proposal.provenance, reason: proposal.reason }, null, 2)}\n`, 'utf8');

  return { designMdPath, designVersion };
}
