import { createHash } from 'node:crypto';
import { parse as parseYaml } from 'yaml';

/** DESIGN.md（Google 格式）解析：YAML frontmatter token + 正文六节。 */

export interface DesignTokens {
  name: string | null;
  description: string | null;
  colors: Record<string, string>;
  typography: Record<string, unknown>;
  raw: Record<string, unknown>;
}

export interface ParsedDesignMd {
  tokens: DesignTokens;
  /** 正文里的标题（## / ###）。 */
  bodySections: string[];
  body: string;
  isDraft: boolean;
}

export interface DesignMdValidationResult {
  valid: boolean;
  missing: string[];
  parsed: ParsedDesignMd;
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

export function parseDesignMd(content: string): ParsedDesignMd {
  const m = content.match(FRONTMATTER_RE);
  let fm: Record<string, unknown> = {};
  let body = content;
  if (m) {
    try {
      const parsed: unknown = parseYaml(m[1] ?? '');
      if (parsed && typeof parsed === 'object') fm = parsed as Record<string, unknown>;
    } catch {
      fm = {};
    }
    body = m[2] ?? '';
  }
  const bodySections = [...body.matchAll(/^#{1,3}\s+(.+)$/gm)].map((x) => (x[1] ?? '').trim());
  return {
    tokens: {
      name: typeof fm.name === 'string' ? fm.name : null,
      description: typeof fm.description === 'string' ? fm.description : null,
      colors: extractStringMap(fm.colors),
      typography: fm.typography && typeof fm.typography === 'object' ? (fm.typography as Record<string, unknown>) : {},
      raw: fm,
    },
    bodySections,
    body,
    isDraft: /ADW DRAFT|DRAFT：/i.test(content.slice(0, 300)),
  };
}

const REQUIRED_SECTIONS = ['Overview', 'Colors', 'Typography', 'Elevation', 'Components', "Do's and Don'ts"];

/**
 * Import gate for agent-generated DESIGN.md.
 * parseDesignMd is intentionally forgiving for existing projects; imports need a strict gate.
 */
export function validateDesignMdForImport(content: string): DesignMdValidationResult {
  const parsed = parseDesignMd(content);
  const missing: string[] = [];
  if (!content.match(FRONTMATTER_RE)) missing.push('frontmatter');
  if (!parsed.tokens.name) missing.push('frontmatter.name');
  if (Object.keys(parsed.tokens.colors).length === 0) missing.push('frontmatter.colors');
  if (Object.keys(parsed.tokens.typography).length === 0) missing.push('frontmatter.typography');

  const sections = new Set(parsed.bodySections.map((s) => normalizeSection(s)));
  for (const section of REQUIRED_SECTIONS) {
    if (!sections.has(normalizeSection(section))) missing.push(`section.${section}`);
  }

  return { valid: missing.length === 0, missing, parsed };
}

function extractStringMap(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (v && typeof v === 'object') {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (typeof val === 'string') out[k] = val;
    }
  }
  return out;
}

function normalizeSection(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/^\d+\.\s*/, '')
    .trim();
}

/** DESIGN.md 内容的版本指纹，写进 Flow Ledger 的 designVersion，用于审查门对齐设计语言版本。 */
export function computeDesignVersion(content: string): string {
  return `sha256:${createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 12)}`;
}
