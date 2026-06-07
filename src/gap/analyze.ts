import type { GapCheck, GapConfig } from '../config/schema.js';
import type { DesignFlowSpec } from '../design-flow/index.js';
import { formatImpeccableFinding, hasBlockingDetectorFinding, type ImpeccableDetectResult } from '../impeccable/index.js';
import type { PageSnapshot } from './snapshot.js';

export type CheckStatus = 'pass' | 'block' | 'advisory' | 'not-run';

export interface CheckResult {
  check: GapCheck;
  status: CheckStatus;
  findings: string[];
  source?: string;
}

function rgbOf(c: string): [number, number, number] | null {
  const s = c.trim().toLowerCase();
  if (s === 'transparent') return null;
  const rgb = s.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (rgb) {
    if (rgb[4] !== undefined && Number(rgb[4]) === 0) return null; // 全透明
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  }
  const hex = s.match(/^#([0-9a-f]{6})$/) ?? s.match(/^#([0-9a-f]{3})$/);
  if (hex && hex[1]) {
    const h = hex[1].length === 3 ? hex[1].split('').map((x) => x + x).join('') : hex[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  return null;
}

/** 有色（非灰阶、非接近黑白）才参与 token 比对，过滤掉默认黑/白/灰带来的噪声。 */
function isChromatic([r, g, b]: [number, number, number]): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max - min > 16 && max > 24 && min < 248;
}

function key(rgb: [number, number, number]): string {
  return rgb.join(',');
}

function severityFor(check: GapCheck, gap: GapConfig): CheckStatus {
  if (gap.blockingChecks.includes(check)) return 'block';
  if (gap.warningChecks.includes(check)) return 'advisory';
  return 'advisory';
}

/**
 * 纯函数：对快照 + 设计 spec + DESIGN.md 调色板 + gap 配置，产出各检查结果。
 * MVP 真正会跑的：token / dom / detector / a11y。state / interaction 诚实标 not-run
 * （需要状态驱动 / 交互驱动，MVP 未实现）。
 */
export function analyzeSnapshot(snapshot: PageSnapshot, spec: DesignFlowSpec, palette: string[] | null, gap: GapConfig, detector: ImpeccableDetectResult): CheckResult[] {
  const results: CheckResult[] = [];

  // token：有色且不在调色板里的颜色才算漂移
  if (!palette || palette.length === 0) {
    results.push({ check: 'token', status: 'not-run', findings: ['没有 DESIGN.md 调色板，token 检查跳过。'] });
  } else {
    const allow = new Set<string>();
    for (const p of palette) {
      const rgb = rgbOf(p);
      if (rgb) allow.add(key(rgb));
    }
    const drift = new Set<string>();
    for (const c of snapshot.usedColors) {
      const rgb = rgbOf(c);
      if (rgb && isChromatic(rgb) && !allow.has(key(rgb))) drift.add(`rgb(${key(rgb)})`);
    }
    results.push(
      drift.size > 0
        ? { check: 'token', status: severityFor('token', gap), findings: [`${drift.size} 个有色调不在 DESIGN.md 调色板：${[...drift].slice(0, 8).join(', ')}`] }
        : { check: 'token', status: 'pass', findings: [] },
    );
  }

  // dom：页面不能是空白；要有可识别标题
  const blank = snapshot.domHtml.replace(/<[^>]+>/g, '').trim().length < 10;
  if (blank) {
    results.push({ check: 'dom', status: severityFor('dom', gap), findings: ['实现页面疑似空白（几乎没有可见文本）。'] });
  } else if (!snapshot.title && !/<h1[\s>]/i.test(snapshot.domHtml)) {
    results.push({ check: 'dom', status: severityFor('dom', gap), findings: ['页面缺少 <title> 和 h1，结构可疑。'] });
  } else {
    results.push({ check: 'dom', status: 'pass', findings: [] });
  }

  // detector：只能来自 Impeccable detect，不再保留 ADW 薄版规则。
  if (!detector.ok) {
    results.push({ check: 'detector', status: severityFor('detector', gap), findings: [`Impeccable detect 未完成：${detector.message}`], source: 'impeccable-detect' });
  } else if (detector.findings.length === 0) {
    results.push({ check: 'detector', status: 'pass', findings: [], source: 'impeccable-detect' });
  } else {
    const status = hasBlockingDetectorFinding(detector.findings) ? severityFor('detector', gap) : 'advisory';
    results.push({ check: 'detector', status, findings: detector.findings.map(formatImpeccableFinding), source: 'impeccable-detect' });
  }

  // a11y：实现页面 a11y 在 MVP 是提醒（与设计稿 a11y 阻塞相对）
  const a11y: string[] = [];
  if (!/<html[^>]+lang=/i.test(snapshot.domHtml)) a11y.push('html 缺少 lang。');
  for (const img of snapshot.domHtml.matchAll(/<img\b[^>]*>/gi)) {
    if (!/\balt\s*=/i.test(img[0])) {
      a11y.push('存在没有 alt 的 <img>。');
      break;
    }
  }
  results.push(a11y.length ? { check: 'a11y', status: 'advisory', findings: a11y } : { check: 'a11y', status: 'pass', findings: [] });

  // state / interaction：MVP 未实现状态驱动 / 交互驱动，诚实标 not-run
  results.push({ check: 'state', status: 'not-run', findings: [`声明了 ${spec.states.length} 个状态，但 MVP 未实现状态驱动，无法验证覆盖。`] });
  results.push({ check: 'interaction', status: 'not-run', findings: ['MVP 未实现交互驱动检查。'] });

  return results;
}

export function countSeverities(results: CheckResult[]): { blockingCount: number; warningCount: number } {
  return {
    blockingCount: results.filter((r) => r.status === 'block').length,
    warningCount: results.filter((r) => r.status === 'advisory').length,
  };
}
