import { join } from 'node:path';
import type { AdwConfig, Viewport } from '../config/schema.js';
import type { DesignFlowSpec, DriverExpectation, InteractionSpec } from '../design-flow/index.js';
import { capturePage, GapCaptureError } from './capture.js';
import type { PageSnapshot } from './snapshot.js';

export type RuntimeDriverStatus = 'pass' | 'failed' | 'not-testable';

export interface RuntimeDriverResult {
  id: string;
  screenId?: string;
  kind?: string;
  status: RuntimeDriverStatus;
  findings: string[];
  screenshotPath: string | null;
}

export interface RuntimeDriverReport {
  states: RuntimeDriverResult[];
  interactions: RuntimeDriverResult[];
}

export interface RuntimeDriverOptions {
  targetDir: string;
  config: AdwConfig;
  slug: string;
  round: number;
  url: string;
  viewport: Viewport;
  storageStatePath?: string;
  spec: DesignFlowSpec;
}

function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'item';
}

function selectorSeen(domHtml: string, selector: string): boolean {
  if (selector.startsWith('#')) return new RegExp(`\\bid=["']${escapeRegExp(selector.slice(1))}["']`, 'i').test(domHtml);
  if (selector.startsWith('.')) return new RegExp(`\\bclass=["'][^"']*\\b${escapeRegExp(selector.slice(1))}\\b`, 'i').test(domHtml);
  const attr = selector.match(/^\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]$/);
  if (attr) {
    const name = escapeRegExp(attr[1] ?? '');
    const value = attr[2] ? `=["']?${escapeRegExp(attr[2])}["']?` : '(?:=["\'][^"\']*["\'])?';
    return new RegExp(`\\b${name}${value}`, 'i').test(domHtml);
  }
  return new RegExp(`<${escapeRegExp(selector)}[\\s>]`, 'i').test(domHtml);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function expectationFindings(snapshot: PageSnapshot, expected: DriverExpectation | undefined): string[] {
  if (!expected) return [];
  const missing: string[] = [];
  if (expected.text && !snapshot.domHtml.includes(expected.text)) missing.push(`未找到期望文本：${expected.text}`);
  if (expected.urlIncludes && !snapshot.url.includes(expected.urlIncludes)) missing.push(`URL 未包含：${expected.urlIncludes}`);
  if (expected.selector && !selectorSeen(snapshot.domHtml, expected.selector)) missing.push(`未找到期望选择器：${expected.selector}`);
  return missing;
}

function blankFindings(snapshot: PageSnapshot): string[] {
  const text = snapshot.domHtml.replace(/<[^>]+>/g, '').trim();
  return text.length < 10 ? ['驱动后页面疑似空白。'] : [];
}

function resultFromSnapshot(id: string, snapshot: PageSnapshot, expected: DriverExpectation | undefined, meta: Partial<RuntimeDriverResult>): RuntimeDriverResult {
  const findings = [...blankFindings(snapshot), ...expectationFindings(snapshot, expected)];
  return {
    id,
    ...meta,
    status: findings.length > 0 ? 'failed' : 'pass',
    findings: findings.length > 0 ? findings : ['已真实驱动并采集页面快照。'],
    screenshotPath: snapshot.screenshotPath,
  };
}

function notTestable(id: string, reason: string, meta: Partial<RuntimeDriverResult>): RuntimeDriverResult {
  return { id, ...meta, status: 'not-testable', findings: [reason], screenshotPath: null };
}

function failed(id: string, err: unknown, meta: Partial<RuntimeDriverResult>): RuntimeDriverResult {
  if (err instanceof GapCaptureError) return { id, ...meta, status: 'failed', findings: [`${err.message} —— ${err.hint}`], screenshotPath: null };
  return { id, ...meta, status: 'failed', findings: [`driver 执行失败：${(err as Error).message}`], screenshotPath: null };
}

function interactionNotTestableReason(interaction: InteractionSpec): string | null {
  if (interaction.notTestableReason) return interaction.notTestableReason;
  if (!interaction.driver) return '缺少 interaction driver；请声明 click/input/scroll/keyboard 等步骤，或显式 notTestableReason。';
  return null;
}

export async function runRuntimeDrivers(opts: RuntimeDriverOptions): Promise<RuntimeDriverReport> {
  const states: RuntimeDriverResult[] = [];
  const interactions: RuntimeDriverResult[] = [];

  for (const state of opts.spec.states) {
    const meta = { screenId: state.screenId, kind: state.kind };
    if (state.notTestableReason) {
      states.push(notTestable(state.id, state.notTestableReason, meta));
      continue;
    }
    if (!state.driver) {
      states.push(notTestable(state.id, '缺少 state driver；请声明 query-param / mock-response / fixture / feature-flag / test-hook，或显式 notTestableReason。', meta));
      continue;
    }
    if (state.driver.type === 'seed-data') {
      states.push(notTestable(state.id, `seed-data 需要外部预置：${state.driver.description}`, meta));
      continue;
    }
    const screenshotRel = join(opts.config.artifactDir, 'assets', opts.slug, 'screenshots', `gap-${opts.round}-state-${safeId(state.id)}.png`);
    try {
      const snapshot = await capturePage(opts.url, opts.viewport, {
        storageStatePath: opts.storageStatePath,
        screenshotPath: join(opts.targetDir, screenshotRel),
        driverBaseDir: opts.targetDir,
        stateDriver: state.driver,
      });
      states.push(resultFromSnapshot(state.id, snapshot, state.expected, meta));
    } catch (err) {
      states.push(failed(state.id, err, meta));
    }
  }

  for (const interaction of opts.spec.interactions) {
    const meta = { screenId: interaction.screenId };
    const reason = interactionNotTestableReason(interaction);
    if (reason) {
      interactions.push(notTestable(interaction.id, reason, meta));
      continue;
    }
    const screenshotRel = join(opts.config.artifactDir, 'assets', opts.slug, 'screenshots', `gap-${opts.round}-interaction-${safeId(interaction.id)}.png`);
    try {
      const snapshot = await capturePage(opts.url, opts.viewport, {
        storageStatePath: opts.storageStatePath,
        screenshotPath: join(opts.targetDir, screenshotRel),
        driverBaseDir: opts.targetDir,
        interactionDriver: interaction.driver,
      });
      interactions.push(resultFromSnapshot(interaction.id, snapshot, interaction.driver?.expected, meta));
    } catch (err) {
      interactions.push(failed(interaction.id, err, meta));
    }
  }

  return { states, interactions };
}
