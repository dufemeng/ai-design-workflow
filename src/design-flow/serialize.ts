import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { stringify as yamlStringify, parse as yamlParse } from 'yaml';
import type { AdwConfig } from '../config/schema.js';
import { type DesignFlowSpec, DesignFlowSpecSchema } from './spec.js';

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
}

/** frontmatter 里不放 mockHtml（presentation，不属于机器可读 gap 输入）。 */
function machineSpec(spec: DesignFlowSpec): Record<string, unknown> {
  return { ...spec, screens: spec.screens.map(({ mockHtml: _omit, ...s }) => s) };
}

function renderBody(spec: DesignFlowSpec): string {
  const lines: string[] = [];
  lines.push(`# ${spec.title}`, '', `> 引用 DESIGN.md 版本：\`${spec.designVersion}\`（不复制全局设计系统）`, '');
  if (spec.background) lines.push('## 背景', spec.background, '');
  if (spec.goals.length) lines.push('## 目标', ...spec.goals.map((g) => `- ${g}`), '');
  if (spec.users || spec.scenario) lines.push('## 用户与场景', [spec.users, spec.scenario].filter(Boolean).join('\n\n'), '');
  if (spec.selectedDirection) lines.push('## 被选方向与取舍', spec.selectedDirection, ...spec.tradeoffs.map((t) => `- 取舍：${t}`), '');
  if (spec.informationArchitecture || spec.mainPath) lines.push('## 信息架构与主路径', spec.informationArchitecture, spec.mainPath, '');
  lines.push('## 屏幕与状态（机器可读，见 frontmatter）');
  for (const screen of spec.screens) {
    const states = spec.states.filter((st) => st.screenId === screen.id);
    lines.push(`### ${screen.name}（\`${screen.id}\`）`, screen.description || '');
    for (const st of states) lines.push(`- 状态 \`${st.kind}\`：${st.description || st.id}`);
    lines.push('');
  }
  lines.push('## 目标 route', spec.targetRoute ? `\`${spec.targetRoute}\`` : '（未指定）', '');
  lines.push('## H5 约束', `- safe-area：${spec.h5Constraints.safeArea}`, `- 键盘：${spec.h5Constraints.keyboard}`, `- 底部操作区：${spec.h5Constraints.bottomActionBar}`, `- tap target ≥ ${spec.h5Constraints.tapTargetMinPx}px`, '');
  if (spec.acceptanceRules.length) lines.push('## 验收规则', ...spec.acceptanceRules.map((a) => `- \`${a.id}\` ${a.rule}${a.check ? `（验：${a.check}）` : ''}`), '');
  if (spec.deviations.length) lines.push('## 偏离根 DESIGN.md', ...spec.deviations.map((d) => `- ${d.rule} —— 理由：${d.reason}`), '');
  return lines.join('\n');
}

/** HTML 设计稿（gap baseline）：每屏一个 section，嵌入 mock（有则）+ 列出状态与验收。 */
export function renderDesignArtifactHtml(spec: DesignFlowSpec): string {
  const sections = spec.screens
    .map((screen) => {
      const states = spec.states.filter((st) => st.screenId === screen.id);
      const acc = spec.acceptanceRules.filter((a) => a.screenId === screen.id);
      const preview = screen.mockHtml
        ? `<div class="phone"><iframe title="${esc(screen.name)}" srcdoc="${esc(screen.mockHtml)}"></iframe></div>`
        : '<div class="phone empty">（无 mock，结构占位）</div>';
      return `
    <section class="screen" data-screen="${esc(screen.id)}">
      <h2>${esc(screen.name)} <code>${esc(screen.id)}</code></h2>
      <p>${esc(screen.description)}</p>
      ${preview}
      <div class="states">${states.map((st) => `<span class="state" data-kind="${esc(st.kind)}">${esc(st.kind)}：${esc(st.description || st.id)}</span>`).join('') || '<em>未声明状态</em>'}</div>
      ${acc.length ? `<ul class="acc">${acc.map((a) => `<li>${esc(a.rule)}</li>`).join('')}</ul>` : ''}
    </section>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="zh-CN" data-adw-page="design-artifact" data-adw-flow="${esc(spec.flow)}" data-design-version="${esc(spec.designVersion)}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>设计稿 · ${esc(spec.title)}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Inter, "PingFang SC", system-ui, sans-serif; color: #1f2328; background: #f6f8fa; }
  header.top { padding: 24px; background: #fff; border-bottom: 1px solid #d0d7de; }
  header.top h1 { margin: 0; font-size: 22px; } header.top .meta { color: #57606a; font-size: 13px; margin-top: 6px; }
  main { padding: 24px; display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
  .screen { background: #fff; border: 1px solid #d0d7de; border-radius: 10px; padding: 16px; }
  .screen h2 { font-size: 16px; margin: 0 0 4px; } .screen code { font-size: 12px; color: #57606a; }
  .phone { background: #0b0b0f; border-radius: 20px; padding: 10px; margin: 10px 0; display: flex; justify-content: center; }
  .phone iframe { width: 320px; height: 560px; border: 0; border-radius: 14px; background: #fff; }
  .phone.empty { color: #8c959f; font-size: 13px; padding: 40px; }
  .states { display: flex; flex-wrap: wrap; gap: 6px; }
  .state { background: #eef2f5; border-radius: 5px; padding: 2px 8px; font-size: 12px; }
  .state[data-kind="error"] { background: #ffebe9; } .state[data-kind="empty"] { background: #fff8c5; }
  .acc { margin: 10px 0 0; padding-left: 18px; font-size: 13px; color: #57606a; }
</style>
</head>
<body>
  <header class="top">
    <h1>${esc(spec.title)}</h1>
    <div class="meta">route：${esc(spec.targetRoute ?? '（未指定）')} · DESIGN.md@${esc(spec.designVersion)} · ${spec.screens.length} 屏 / ${spec.states.length} 状态 / ${spec.acceptanceRules.length} 验收</div>
  </header>
  <main>${sections}</main>
</body>
</html>
`;
}

export interface WriteResult {
  mdPath: string;
  htmlPath: string;
  mdRel: string;
  htmlRel: string;
}

export function writeDesignFlow(targetDir: string, config: AdwConfig, spec: DesignFlowSpec): WriteResult {
  const md = `---\n${yamlStringify(machineSpec(spec))}---\n\n${renderBody(spec)}\n`;
  const html = renderDesignArtifactHtml(spec);
  const mdRel = join(config.artifactDir, `design-${spec.flow}.md`);
  const htmlRel = join(config.artifactDir, `design-${spec.flow}.html`);
  const mdPath = join(targetDir, mdRel);
  const htmlPath = join(targetDir, htmlRel);
  mkdirSync(dirname(mdPath), { recursive: true });
  writeFileSync(mdPath, md, 'utf8');
  writeFileSync(htmlPath, html, 'utf8');
  return { mdPath, htmlPath, mdRel, htmlRel };
}

/** 从 design-<flow>.md 读回 spec（frontmatter）。供 T8 审查门 / T10 gap 用。 */
export function parseDesignFlow(content: string): DesignFlowSpec {
  const m = content.match(FRONTMATTER_RE);
  if (!m) throw new Error('design-<flow>.md 缺少 frontmatter');
  const data: unknown = yamlParse(m[1] ?? '');
  return DesignFlowSpecSchema.parse(data);
}
