import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AdwConfig } from '../config/schema.js';
import { splitFindings } from '../autofix/index.js';
import { FlowLedgerStore } from '../flow/index.js';
import { GapReportSchema } from '../gap/index.js';

export class LiveError extends Error {
  constructor(
    message: string,
    readonly hint: string,
  ) {
    super(message);
    this.name = 'LiveError';
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
}

export interface LiveWorkbenchResult {
  path: string;
  problemCount: number;
}

/**
 * T12：生成人工 live review workbench。
 * 硬约束：必须先有 gap 报告才能进 live —— live 不是第一道调试入口，
 * 只处理自动 loop 修不了 / 判不准的问题。真正改运行页面复用 Impeccable live。
 */
export function generateLiveWorkbench(targetDir: string, config: AdwConfig, slug: string): LiveWorkbenchResult {
  const ledger = new FlowLedgerStore(targetDir, config.artifactDir).read(slug);
  const lastRef = ledger.artifactRefs.gapReports.at(-1);
  if (!lastRef) {
    throw new LiveError('还没有 gap 报告，live 不是第一道调试入口。', '先跑 gap:run，再从 gap 结果进入 live。');
  }
  const report = GapReportSchema.parse(JSON.parse(readFileSync(join(targetDir, lastRef), 'utf8')));

  const split = splitFindings(report.checks);
  const advisory = report.checks.filter((c) => c.status === 'advisory');
  const problems = [
    ...split.toLive.map((c) => ({ kind: '阻塞·需人工', check: c.check, findings: c.findings })),
    ...advisory.map((c) => ({ kind: '提醒', check: c.check, findings: c.findings })),
  ];

  const route = ledger.implementationTarget?.route ?? '（未设定）';
  const items = problems
    .map(
      (p) => `<li><span class="k">${esc(p.kind)}</span> <code>${esc(p.check)}</code><div>${p.findings.map(esc).join('<br/>') || '—'}</div></li>`,
    )
    .join('\n');

  const html = `<!doctype html>
<html lang="zh-CN" data-adw-page="live-review" data-adw-flow="${esc(slug)}">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>live review · ${esc(slug)}</title>
<style>
  body { margin:0; font-family:Inter,"PingFang SC",system-ui,sans-serif; background:#f6f8fa; color:#1f2328; }
  main { max-width:820px; margin:0 auto; padding:32px 24px; }
  .meta { color:#57606a; font-size:13px; margin-bottom:16px; }
  ul { list-style:none; padding:0; } li { background:#fff; border:1px solid #d0d7de; border-radius:8px; padding:12px 14px; margin-bottom:10px; }
  .k { font-size:11px; background:#eef2f5; border-radius:4px; padding:1px 6px; } code { color:#57606a; }
  .note { margin-top:20px; padding:12px 14px; border-left:3px solid #0969da; background:#ddf4ff; font-size:13px; }
</style></head>
<body><main>
  <h1>人工 live review：${esc(slug)}</h1>
  <div class="meta">实现页面 route：${esc(route)} · 来自最近一轮 gap（阻塞 ${report.blockingCount} / 提醒 ${report.warningCount}）</div>
  <ul>${items || '<li>没有需人工处理的问题。</li>'}</ul>
  <div class="note">
    在页面上选区域、真正改运行页面：复用 <b>Impeccable live</b>（H5-first、本地 patch + 参数 knob 优先，别每个小改都等大模型）。<br/>
    每次改动用 <code>adw live:record</code> 记一条 PatchIntent；<b>接受 patch 后必须重跑相关 gap</b> 复验。
  </div>
</main></body></html>
`;

  const path = join(targetDir, config.artifactDir, 'assets', slug, 'live-review.html');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, html, 'utf8');
  return { path, problemCount: problems.length };
}
