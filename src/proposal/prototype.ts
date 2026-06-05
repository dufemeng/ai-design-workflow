import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { AdwConfig } from '../config/schema.js';
import { loadRegistry, RegistryError } from '../templates/index.js';

/**
 * T6：HTML 原型发散 workbench。
 * 方向内容（轴、取舍、H5 预览）由 agent 运行时生成；本模块是确定性组装器：
 * 把 2-3 个方向拼成一张可并排比较的静态页，每个方向嵌入真实 H5 预览（来自模板 shell）。
 * 决策不在页面里发生——用户看完口述给 agent，agent 用 approvePrototype 落 ledger。
 */

export const PrototypeDirectionSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    axis: z.string().min(1), // 探索主轴：信息架构 / 交互路径 / 视觉气质 / 密度 / 转化路径
    fitScenario: z.string().min(1),
    tradeoffs: z.array(z.string()).default([]),
    templateId: z.string().optional(),
    injections: z.record(z.string()).default({}),
    previewHtml: z.string().optional(),
  })
  .refine((d) => d.templateId || d.previewHtml, { message: '每个方向必须给 templateId 或 previewHtml' });
export type PrototypeDirection = z.infer<typeof PrototypeDirectionSchema>;

export const ProposalSpecSchema = z.object({
  directions: z.array(PrototypeDirectionSchema).min(2).max(3),
});
export type ProposalSpec = z.infer<typeof ProposalSpecSchema>;

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
}

/** 把内容注入 shell 的 `<!-- ADW:KEY -->` 占位符。 */
export function injectIntoShell(shell: string, injections: Record<string, string>): string {
  let out = shell;
  for (const [key, value] of Object.entries(injections)) {
    out = out.split(`<!-- ADW:${key} -->`).join(value);
  }
  return out;
}

interface ResolvedDirection extends PrototypeDirection {
  previewHtml: string;
}

function renderWorkbench(slug: string, directions: ResolvedDirection[]): string {
  const cards = directions
    .map(
      (d) => `
    <section class="dir">
      <header><span class="tag">${esc(d.id)}</span><h2>${esc(d.label)}</h2></header>
      <dl>
        <dt>探索主轴</dt><dd>${esc(d.axis)}</dd>
        <dt>适合场景</dt><dd>${esc(d.fitScenario)}</dd>
        <dt>取舍</dt><dd><ul>${d.tradeoffs.map((t) => `<li>${esc(t)}</li>`).join('') || '<li>—</li>'}</ul></dd>
      </dl>
      <div class="preview"><iframe title="${esc(d.label)} 预览" srcdoc="${esc(d.previewHtml)}" loading="lazy"></iframe></div>
    </section>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="zh-CN" data-adw-page="proposal-workbench" data-adw-flow="${esc(slug)}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>原型方向 · ${esc(slug)}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Inter, "PingFang SC", system-ui, sans-serif; color: #1f2328; background: #f6f8fa; }
  header.top { padding: 24px; }
  header.top h1 { margin: 0; font-size: 22px; }
  header.top p { margin: 4px 0 0; color: #57606a; font-size: 14px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; padding: 0 24px 24px; }
  .dir { background: #fff; border: 1px solid #d0d7de; border-radius: 10px; overflow: hidden; display: flex; flex-direction: column; }
  .dir header { display: flex; align-items: center; gap: 8px; padding: 14px 16px; border-bottom: 1px solid #eaecef; }
  .dir .tag { background: #1f2328; color: #fff; border-radius: 5px; padding: 2px 8px; font-size: 13px; font-weight: 700; }
  .dir h2 { margin: 0; font-size: 16px; }
  dl { margin: 0; padding: 14px 16px; font-size: 13px; }
  dt { color: #57606a; text-transform: uppercase; letter-spacing: .03em; font-size: 11px; margin-top: 8px; }
  dd { margin: 2px 0 0; } dd ul { margin: 4px 0 0; padding-left: 18px; }
  .preview { background: #0b0b0f; display: flex; justify-content: center; padding: 16px; }
  .preview iframe { width: 360px; height: 640px; border: 0; border-radius: 24px; background: #fff; }
</style>
</head>
<body>
  <header class="top">
    <h1>原型方向：${esc(slug)}</h1>
    <p>并排比较 ${directions.length} 个方向。看完请告诉 agent：选哪个 / 合并哪些 / 否决，agent 会用 approvePrototype 记录。</p>
  </header>
  <div class="grid">${cards}</div>
</body>
</html>
`;
}

export interface GenerateResult {
  path: string;
  count: number;
}

/** 生成 docs/proposal-<slug>.html。每个方向的 H5 预览基于模板 registry 的 shell。 */
export function generateProposalWorkbench(targetDir: string, config: AdwConfig, slug: string, spec: ProposalSpec): GenerateResult {
  const { registry } = loadRegistry(config.templateRegistry, targetDir);

  const resolved: ResolvedDirection[] = spec.directions.map((d) => {
    if (d.previewHtml) return { ...d, previewHtml: d.previewHtml };
    if (!d.templateId) throw new RegistryError(`方向「${d.id}」既无 previewHtml 也无 templateId`, '二选一。');
    const shell = readFileSync(registry.shellAbsPath(d.templateId), 'utf8');
    return { ...d, previewHtml: injectIntoShell(shell, d.injections) };
  });

  const html = renderWorkbench(slug, resolved);
  const path = join(targetDir, config.artifactDir, `proposal-${slug}.html`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, html, 'utf8');
  return { path, count: resolved.length };
}
