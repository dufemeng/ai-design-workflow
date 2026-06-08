import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GapConfig } from '../config/schema.js';
import type { CheckResult } from './analyze.js';

export interface DesignBaseline {
  sourceRel: string;
  confidence: 'high' | 'low';
  chromeStripped: boolean;
  texts: string[];
  stateKinds: string[];
  interactionIds: string[];
}

function decodeHtml(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function stripTags(s: string): string {
  return decodeHtml(s)
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function extractTextsFromHtml(html: string): string[] {
  const semanticTexts: string[] = [];
  for (const m of html.matchAll(/<(h[1-6]|p|button|label|a|li|strong|em|span)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const text = stripTags(m[2] ?? '');
    if (text) semanticTexts.push(text);
  }
  if (semanticTexts.length > 0) {
    return unique(semanticTexts.map((t) => t.trim()).filter((t) => t.length >= 2 && t.length <= 60)).slice(0, 24);
  }
  const text = stripTags(html);
  if (!text) return [];
  return unique(
    text
      .split(/[。！？.!?\n\r]| {2,}/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2 && t.length <= 60)
      .filter((t) => !/^(route|design\.md|sha256|viewport)$/i.test(t)),
  ).slice(0, 24);
}

function attrValues(html: string, attr: string): string[] {
  const values: string[] = [];
  const re = new RegExp(`\\b${attr}=["']([^"']+)["']`, 'gi');
  for (const m of html.matchAll(re)) {
    if (m[1]) values.push(decodeHtml(m[1]));
  }
  return unique(values);
}

function iframeSrcdocs(html: string): string[] {
  const values: string[] = [];
  for (const m of html.matchAll(/\bsrcdoc=["']([^"']*)["']/gi)) {
    if (m[1]) values.push(decodeHtml(m[1]));
  }
  return values;
}

function surfaceHtml(html: string): string | null {
  const m = html.match(/<main\b[^>]*\bdata-design-surface=["'][^"']+["'][^>]*>([\s\S]*?)<\/main>/i);
  return m?.[1] ?? null;
}

export function extractDesignBaseline(sourceRel: string, html: string): DesignBaseline {
  const srcdocs = iframeSrcdocs(html);
  const highConfidence = srcdocs.length > 0;
  const body = highConfidence ? srcdocs.join('\n') : surfaceHtml(html) ?? html;
  return {
    sourceRel,
    confidence: highConfidence ? 'high' : 'low',
    chromeStripped: highConfidence || /\bdata-design-chrome=/.test(html),
    texts: extractTextsFromHtml(body),
    stateKinds: attrValues(html, 'data-kind'),
    interactionIds: attrValues(html, 'data-interaction'),
  };
}

function missingTexts(baseline: DesignBaseline, implementationDomHtml: string): string[] {
  const impl = stripTags(implementationDomHtml);
  return baseline.texts.filter((t) => !impl.includes(t));
}

function statusForMissing(confidence: DesignBaseline['confidence'], gap: GapConfig): CheckResult['status'] {
  if (confidence === 'low') return 'advisory';
  return gap.blockingChecks.includes('dom') ? 'block' : 'advisory';
}

export function analyzeDesignBaselineDiff(baseline: DesignBaseline, implementationDomHtml: string, gap: GapConfig): CheckResult {
  if (baseline.texts.length === 0 && baseline.stateKinds.length === 0 && baseline.interactionIds.length === 0) {
    return {
      check: 'dom',
      status: 'not-run',
      findings: [`baseline 没有可比较的文本或标记：${baseline.sourceRel}`],
      source: `design-baseline:${baseline.sourceRel}`,
    };
  }
  const missing = missingTexts(baseline, implementationDomHtml);
  if (missing.length === 0) {
    return {
      check: 'dom',
      status: 'pass',
      findings: [],
      source: `design-baseline:${baseline.sourceRel}`,
    };
  }
  const confidenceNote =
    baseline.confidence === 'high'
      ? 'baseline 来自 iframe srcdoc，已剥离审阅 chrome。'
      : 'baseline 缺少高置信 srcdoc，已降级为提醒，建议补 data-design-surface / data-design-chrome。';
  return {
    check: 'dom',
    status: statusForMissing(baseline.confidence, gap),
    findings: [`设计稿有、实现页缺的关键文本：${missing.slice(0, 8).join('、')}`, confidenceNote],
    source: `design-baseline:${baseline.sourceRel}`,
  };
}

export function analyzeDesignBaselineFile(targetDir: string, designHtmlRel: string, implementationDomHtml: string, gap: GapConfig): CheckResult {
  const path = join(targetDir, designHtmlRel);
  if (!existsSync(path)) {
    return {
      check: 'dom',
      status: 'not-run',
      findings: [`找不到设计稿 baseline：${designHtmlRel}`],
      source: `design-baseline:${designHtmlRel}`,
    };
  }
  const baseline = extractDesignBaseline(designHtmlRel, readFileSync(path, 'utf8'));
  return analyzeDesignBaselineDiff(baseline, implementationDomHtml, gap);
}
