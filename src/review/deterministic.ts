import type { DesignFlowSpec } from '../design-flow/index.js';

/**
 * T8 确定性规则（静态子集）。在不开浏览器的前提下能查的：viewport、tap-target 声明、
 * 状态覆盖、设计稿 a11y、AI slop、token 漂移。
 * 需要渲染几何的（overflow、真实 tap 几何、对比度）留给 T10 gap loop 在浏览器里查。
 */

export interface DeterministicFinding {
  rule: string;
  severity: 'block' | 'advisory';
  message: string;
  evidence?: string;
}

const HEX_RE = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g;

export function runDeterministicRules(html: string, spec: DesignFlowSpec, palette: string[] | null): DeterministicFinding[] {
  const f: DeterministicFinding[] = [];
  const block = (rule: string, message: string, evidence?: string) => f.push({ rule, severity: 'block', message, evidence });
  const advise = (rule: string, message: string, evidence?: string) => f.push({ rule, severity: 'advisory', message, evidence });

  // viewport
  if (!/<meta[^>]+name=["']viewport["'][^>]*width=device-width/i.test(html)) {
    block('viewport', 'H5 设计稿缺少 width=device-width 的 viewport meta。');
  }

  // tap target（声明值）
  if (spec.h5Constraints.tapTargetMinPx < 44) {
    block('tap-target', `tap target 声明为 ${spec.h5Constraints.tapTargetMinPx}px，小于 44px 最小可点区。`);
  }

  // 状态覆盖
  for (const screen of spec.screens) {
    const n = spec.states.filter((s) => s.screenId === screen.id).length;
    if (n === 0) block('state-coverage', `屏幕「${screen.name}」没有声明任何状态。`, screen.id);
  }
  const kinds = new Set(spec.states.map((s) => s.kind));
  if (spec.states.length > 0 && !kinds.has('error')) block('state-coverage', '整个 flow 没有声明 error 状态。');
  for (const k of ['empty', 'loading'] as const) {
    if (spec.states.length > 0 && !kinds.has(k)) advise('state-coverage', `flow 没有声明 ${k} 状态。`);
  }

  // 设计稿 a11y（静态）——设计稿 a11y 阻塞是有意策略
  if (!/<html[^>]+lang=/i.test(html)) block('a11y', 'html 缺少 lang 属性。');
  if (!/<title>/i.test(html)) block('a11y', '页面缺少 <title>。');
  for (const img of html.matchAll(/<img\b[^>]*>/gi)) {
    if (!/\balt\s*=/i.test(img[0])) block('a11y', '存在没有 alt 的 <img>。', img[0].slice(0, 60));
  }
  for (const tag of ['a', 'button'] as const) {
    const re = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)</${tag}>`, 'gi');
    for (const m of html.matchAll(re)) {
      const attrs = m[1] ?? '';
      const inner = (m[2] ?? '').replace(/<[^>]+>/g, '').trim();
      if (!inner && !/aria-label\s*=/i.test(attrs)) block('a11y', `<${tag}> 没有可访问名称（无文本也无 aria-label）。`, m[0].slice(0, 60));
    }
  }

  // detector：明显 AI slop
  if (/lorem ipsum/i.test(html)) block('detector', '出现 lorem ipsum 占位文案。');
  if (/>\s*click here\s*</i.test(html)) block('detector', '出现「Click here」泛化文案。');
  if (/\bTODO\b/.test(html)) advise('detector', '设计稿里残留 TODO。');

  // token 漂移（有 DESIGN.md 调色板时，做提醒不阻塞——静态阶段噪声大）
  if (palette && palette.length > 0) {
    const allow = new Set(palette.map((p) => p.toLowerCase()));
    const drift = new Set<string>();
    for (const m of html.matchAll(HEX_RE)) {
      const hex = m[0].toLowerCase();
      if (!allow.has(hex)) drift.add(hex);
    }
    if (drift.size > 0) advise('token-drift', `${drift.size} 个颜色不在 DESIGN.md 调色板内（静态提醒，渲染期 token diff 在 gap loop 复核）。`, [...drift].slice(0, 8).join(', '));
  }

  // safe-area（要求但未引用 → 提醒）
  if (spec.h5Constraints.safeArea && !/safe-area-inset/.test(html)) {
    advise('safe-area', '声明需要 safe-area，但设计稿未引用 safe-area-inset。');
  }

  return f;
}
