import type { ParsedDesignMd } from './designmd.js';

export interface ConfirmationMeta {
  isDraft: boolean;
  designVersion: string | null;
  sourceNote: string;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
}

function swatch(name: string, value: string): string {
  const safe = /^#[0-9a-fA-F]{3,8}$|^rgba?\(/.test(value) ? value : 'transparent';
  return `<div class="sw"><span class="chip" style="background:${esc(safe)}"></span><code>${esc(name)}</code><small>${esc(value)}</small></div>`;
}

function typeSample(name: string, spec: Record<string, unknown>): string {
  const size = typeof spec.fontSize === 'string' ? spec.fontSize : '16px';
  const weight = typeof spec.fontWeight === 'number' || typeof spec.fontWeight === 'string' ? String(spec.fontWeight) : '400';
  const family = typeof spec.fontFamily === 'string' ? spec.fontFamily : 'inherit';
  return `<div class="type" style="font-size:${esc(size)};font-weight:${esc(weight)};font-family:${esc(family)}">${esc(name)} — 设计语言示例 Design Aa 123</div>`;
}

/** 从正文里抓 Do / Don't 小节的条目（粗略）。 */
function extractDosDonts(body: string): { dos: string[]; donts: string[] } {
  const dos: string[] = [];
  const donts: string[] = [];
  let bucket: string[] | null = null;
  for (const line of body.split('\n')) {
    if (/^#{1,4}.*(do['’]?s|do\b|该做)/i.test(line) && !/don/i.test(line)) bucket = dos;
    else if (/^#{1,4}.*(don['’]?ts?|别|不要)/i.test(line)) bucket = donts;
    else if (/^#{1,4}\s/.test(line)) bucket = null;
    else if (bucket && /^\s*[-*]\s+/.test(line)) bucket.push(line.replace(/^\s*[-*]\s+/, '').trim());
  }
  return { dos: dos.slice(0, 8), donts: donts.slice(0, 8) };
}

/** 生成 DESIGN.md 可视化确认页：调性、色板、字体、Do/Don't、证据、版本。自包含静态页。 */
export function renderConfirmationHtml(parsed: ParsedDesignMd, meta: ConfirmationMeta): string {
  const t = parsed.tokens;
  const swatches = Object.entries(t.colors).map(([k, v]) => swatch(k, v)).join('\n');
  const types = Object.entries(t.typography)
    .filter(([, v]) => v && typeof v === 'object')
    .map(([k, v]) => typeSample(k, v as Record<string, unknown>))
    .join('\n');
  const { dos, donts } = extractDosDonts(parsed.body);
  const draftBanner = meta.isDraft
    ? `<div class="draft">⚠ DRAFT — 这是种子草稿，确认前不是权威 DESIGN.md。${esc(meta.sourceNote)}</div>`
    : '';

  return `<!doctype html>
<html lang="zh-CN" data-adw-page="design-system-confirmation">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>DESIGN.md 确认页 · ${esc(t.name ?? '设计语言')}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Inter, "PingFang SC", system-ui, sans-serif; color: #1f2328; background: #fafafa; line-height: 1.5; }
  main { max-width: 960px; margin: 0 auto; padding: 40px 24px; }
  h1 { font-size: 28px; margin: 0 0 4px; } .desc { color: #57606a; margin: 0 0 24px; }
  h2 { font-size: 16px; text-transform: uppercase; letter-spacing: .04em; color: #57606a; margin: 32px 0 12px; }
  .draft { background: #fff8c5; border: 1px solid #d4a72c; padding: 10px 14px; border-radius: 6px; margin-bottom: 20px; font-size: 14px; }
  .palette { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
  .sw { display: flex; align-items: center; gap: 8px; background: #fff; border: 1px solid #eaecef; border-radius: 6px; padding: 8px; }
  .chip { width: 28px; height: 28px; border-radius: 5px; border: 1px solid rgba(0,0,0,.1); flex: none; }
  .sw code { font-size: 12px; } .sw small { color: #8c959f; font-size: 11px; margin-left: auto; }
  .type { background: #fff; border: 1px solid #eaecef; border-radius: 6px; padding: 12px 16px; margin-bottom: 8px; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .card { background: #fff; border: 1px solid #eaecef; border-radius: 6px; padding: 16px; }
  .card.do { border-left: 3px solid #2da44e; } .card.dont { border-left: 3px solid #cf222e; }
  footer { margin-top: 40px; color: #8c959f; font-size: 12px; border-top: 1px solid #eaecef; padding-top: 16px; }
</style>
</head>
<body>
<main>
  ${draftBanner}
  <h1>${esc(t.name ?? '设计语言')}</h1>
  <p class="desc">${esc(t.description ?? '（无产品调性描述）')}</p>

  <h2>色板 Palette（${Object.keys(t.colors).length}）</h2>
  <div class="palette">${swatches || '<p>（未检测到颜色 token）</p>'}</div>

  <h2>字体层级 Typography</h2>
  ${types || '<p>（未检测到字体 token）</p>'}

  <h2>Do / Don't</h2>
  <div class="cols">
    <div class="card do"><strong>Do</strong><ul>${dos.map((d) => `<li>${esc(d)}</li>`).join('') || '<li>（无）</li>'}</ul></div>
    <div class="card dont"><strong>Don't</strong><ul>${donts.map((d) => `<li>${esc(d)}</li>`).join('') || '<li>（无）</li>'}</ul></div>
  </div>

  <footer>
    证据来源：${esc(meta.sourceNote)}<br />
    designVersion：${esc(meta.designVersion ?? '（草稿未定版）')}<br />
    正文小节：${parsed.bodySections.map(esc).join(' · ') || '（无）'}
  </footer>
</main>
</body>
</html>
`;
}
