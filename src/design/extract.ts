import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { walkFiles } from '../scan/scanner.js';

const HEX_RE = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g;
const CUSTOM_PROP_RE = /--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))/g;

/**
 * 从目标项目的 CSS / tailwind 配置里抽取候选色板，作为冷启动 DESIGN.md 草稿的种子。
 * 命名 CSS 变量优先，剩余用匿名 hex 补足。这是「从代码抽取证据」的轻量版，结果是草稿，需人复核。
 */
export function extractColorSeeds(targetDir: string): Record<string, string> {
  const files = walkFiles(targetDir).filter((f) => /\.css$/.test(f) || /tailwind\.config\.[cm]?[jt]s$/.test(f));
  const named: Record<string, string> = {};
  const anon: string[] = [];
  let read = 0;

  for (const rel of files) {
    if (read >= 40) break;
    let text: string;
    try {
      text = readFileSync(join(targetDir, rel), 'utf8');
    } catch {
      continue;
    }
    read++;
    for (const m of text.matchAll(CUSTOM_PROP_RE)) {
      const name = m[1];
      const val = m[2];
      if (name && val && !(name in named) && Object.keys(named).length < 16) named[name] = val;
    }
    for (const m of text.matchAll(HEX_RE)) {
      const hex = m[0].toLowerCase();
      if (!anon.includes(hex)) anon.push(hex);
    }
  }

  const out: Record<string, string> = { ...named };
  let i = 1;
  for (const hex of anon) {
    if (Object.keys(out).length >= 12) break;
    if (!Object.values(out).includes(hex)) out[`color-${i++}`] = hex;
  }
  return out;
}
