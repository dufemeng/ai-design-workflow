import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { GapCheckSchema, ViewportSchema } from '../config/schema.js';
import type { AdwConfig } from '../config/schema.js';

export const CheckResultSchema = z.object({
  check: GapCheckSchema,
  status: z.enum(['pass', 'block', 'advisory', 'not-run', 'not-testable']),
  findings: z.array(z.string()),
  source: z.string().optional(),
});

export const GapReportSchema = z.object({
  schemaVersion: z.literal(1),
  slug: z.string(),
  url: z.string(),
  viewport: ViewportSchema,
  designVersion: z.string().nullable(),
  at: z.string(),
  captureStatus: z.enum(['ok', 'failed']),
  checks: z.array(CheckResultSchema),
  blockingCount: z.number().int().nonnegative(),
  warningCount: z.number().int().nonnegative(),
  screenshotPath: z.string().nullable(),
  note: z.string(),
});
export type GapReport = z.infer<typeof GapReportSchema>;

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
}

const STATUS_LABEL: Record<string, string> = { pass: '通过', block: '阻塞', advisory: '提醒', 'not-run': '未跑', 'not-testable': '不可测' };

export function renderGapHtml(report: GapReport): string {
  const rows = report.checks
    .map(
      (c) => `<tr data-status="${c.status}"><td>${esc(c.check)}${c.source ? `<br/><small>${esc(c.source)}</small>` : ''}</td><td>${STATUS_LABEL[c.status] ?? c.status}</td><td>${c.findings.map(esc).join('<br/>') || '—'}</td></tr>`,
    )
    .join('\n');
  return `<!doctype html>
<html lang="zh-CN" data-adw-page="gap-report" data-adw-flow="${esc(report.slug)}">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>gap report · ${esc(report.slug)}</title>
<style>
  body { margin:0; font-family: ui-monospace, "JetBrains Mono", "PingFang SC", monospace; background:#0a0a0a; color:#e5e3d3; }
  main { max-width: 960px; margin: 0 auto; padding: 32px 24px; }
  .meta { color:#93927c; font-size:13px; margin-bottom:16px; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th,td { text-align:left; padding:8px; border-bottom:1px solid rgba(255,255,255,.08); vertical-align:top; }
  tr[data-status="block"] td:nth-child(2){ color:#ffb4ab; } tr[data-status="advisory"] td:nth-child(2){ color:#f59e0b; }
  tr[data-status="pass"] td:nth-child(2){ color:#22c55e; } tr[data-status="not-run"] td:nth-child(2), tr[data-status="not-testable"] td:nth-child(2){ color:#93927c; }
</style></head>
<body><main>
  <h1>gap report：${esc(report.slug)}</h1>
  <div class="meta">URL：${esc(report.url)} · viewport：${report.viewport.width}×${report.viewport.height} · DESIGN.md@${esc(report.designVersion ?? '—')}<br/>
  采集：${report.captureStatus} · 阻塞 ${report.blockingCount} / 提醒 ${report.warningCount}${report.note ? ` · ${esc(report.note)}` : ''}</div>
  <table><thead><tr><th>检查</th><th>判定</th><th>说明</th></tr></thead><tbody>${rows}</tbody></table>
</main></body></html>
`;
}

export interface WriteGapResult {
  jsonRel: string;
  jsonPath: string;
  htmlRel: string;
  htmlPath: string;
  latestJsonRel: string;
  latestHtmlRel: string;
}

/**
 * 每轮 gap report 独立留档，历史不被覆盖：gap-report-<runId>.json/.html（runId = 递增轮次）。
 * 另写 gap-report-latest.json/.html 指向最新一轮，给「只想看最新」的消费方。
 */
export function writeGapReport(targetDir: string, config: AdwConfig, slug: string, report: GapReport, round: number): WriteGapResult {
  const dir = join(config.artifactDir, 'assets', slug);
  const jsonRel = join(dir, `gap-report-${round}.json`);
  const htmlRel = join(dir, `gap-report-${round}.html`);
  const latestJsonRel = join(dir, 'gap-report-latest.json');
  const latestHtmlRel = join(dir, 'gap-report-latest.html');
  const jsonPath = join(targetDir, jsonRel);
  const htmlPath = join(targetDir, htmlRel);
  mkdirSync(dirname(jsonPath), { recursive: true });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const html = renderGapHtml(report);
  writeFileSync(jsonPath, json, 'utf8');
  writeFileSync(htmlPath, html, 'utf8');
  writeFileSync(join(targetDir, latestJsonRel), json, 'utf8');
  writeFileSync(join(targetDir, latestHtmlRel), html, 'utf8');
  return { jsonRel, jsonPath, htmlRel, htmlPath, latestJsonRel, latestHtmlRel };
}
