import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AdwConfig } from '../config/schema.js';
import { assembleCodeContext } from '../code/index.js';
import { parseDesignMd } from '../design/index.js';
import { FlowLedgerStore } from '../flow/index.js';
import { runImpeccableDetect } from '../impeccable/index.js';
import { analyzeSnapshot, countSeverities } from './analyze.js';
import { capturePage, GapCaptureError } from './capture.js';
import { type GapReport, GapReportSchema, writeGapReport } from './report.js';

export interface GapRunResult {
  report: GapReport;
  jsonRel: string;
  attached: boolean;
}

/**
 * 跑一轮 gap：采集实现页面 → 分析 → 写报告 → （采集成功才）attach 到 ledger。
 * 采集失败（无浏览器/打不开）不伪造通过：写一份 failed 报告，不 attach。
 */
export async function runGapLoop(targetDir: string, config: AdwConfig, slug: string, opts: { url: string; storageStatePath?: string }): Promise<GapRunResult> {
  const ctx = assembleCodeContext(targetDir, config, slug); // 不在 code 阶段会抛
  const store = new FlowLedgerStore(targetDir, config.artifactDir);
  const round = store.read(slug).gapHistory.length;
  const viewport = config.defaultViewports[0] ?? { name: 'mobile', width: 393, height: 852 };
  const at = new Date().toISOString();

  const screenshotRel = join(config.artifactDir, 'assets', slug, 'screenshots', `gap-${round}.png`);

  let palette: string[] | null = null;
  const designMdPath = join(targetDir, config.designMdPath);
  if (existsSync(designMdPath)) palette = Object.values(parseDesignMd(readFileSync(designMdPath, 'utf8')).tokens.colors);

  let report: GapReport;
  try {
    const snapshot = await capturePage(opts.url, viewport, {
      storageStatePath: opts.storageStatePath,
      screenshotPath: join(targetDir, screenshotRel),
    });
    const detector = runImpeccableDetect(opts.url, { cwd: targetDir });
    const checks = analyzeSnapshot(snapshot, ctx.spec, palette, config.gap, detector);
    const counts = countSeverities(checks);
    report = GapReportSchema.parse({
      schemaVersion: 1,
      slug,
      url: opts.url,
      viewport,
      designVersion: ctx.designVersion,
      at,
      captureStatus: 'ok',
      checks,
      blockingCount: counts.blockingCount,
      warningCount: counts.warningCount,
      screenshotPath: snapshot.screenshotPath ? screenshotRel : null,
      note: '',
    });
  } catch (err) {
    if (!(err instanceof GapCaptureError)) throw err;
    report = GapReportSchema.parse({
      schemaVersion: 1,
      slug,
      url: opts.url,
      viewport,
      designVersion: ctx.designVersion,
      at,
      captureStatus: 'failed',
      checks: [],
      blockingCount: 0,
      warningCount: 0,
      screenshotPath: null,
      note: `采集失败：${err.message} —— ${err.hint}`,
    });
  }

  const { jsonRel } = writeGapReport(targetDir, config, slug, report, round);

  let attached = false;
  if (report.captureStatus === 'ok') {
    store.apply(slug, { type: 'attachGapReport', reportRef: jsonRel, blockingCount: report.blockingCount, warningCount: report.warningCount });
    attached = true;
  }
  return { report, jsonRel, attached };
}
