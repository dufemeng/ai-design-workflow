import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export const SkillHarnessSchema = z.enum(['claude-code', 'codex', 'both']);
export type SkillHarness = z.infer<typeof SkillHarnessSchema>;

export class SkillInstallError extends Error {
  constructor(
    message: string,
    readonly hint: string,
  ) {
    super(message);
    this.name = 'SkillInstallError';
  }
}

export interface SkillInstallResult {
  installed: string[];
  skipped: string[];
}

const BEGIN = '<!-- BEGIN ADW WORKFLOW SKILL -->';
const END = '<!-- END ADW WORKFLOW SKILL -->';

export function installAdwSkill(targetDir: string, opts: { harness: SkillHarness; update: boolean }): SkillInstallResult {
  const installed: string[] = [];
  const skipped: string[] = [];
  const skill = readSkillSource('SKILL.md');
  const snippet = readSkillSource('AGENTS.snippet.md');

  if (opts.harness === 'claude-code' || opts.harness === 'both') {
    const rel = join('.claude', 'skills', 'adw-workflow', 'SKILL.md');
    const path = join(targetDir, rel);
    if (existsSync(path) && !opts.update) {
      skipped.push(`${rel}（已存在；用 --update 覆盖）`);
    } else {
      writeFile(path, skill);
      installed.push(rel);
    }
  }

  if (opts.harness === 'codex' || opts.harness === 'both') {
    const rel = 'AGENTS.md';
    const path = join(targetDir, rel);
    const current = existsSync(path) ? readFileSync(path, 'utf8') : '';
    const block = `${BEGIN}\n${snippet.trim()}\n${END}`;
    let next: string;
    if (current.includes(BEGIN) && current.includes(END)) {
      if (!opts.update) {
        skipped.push(`${rel}（ADW 区块已存在；用 --update 覆盖）`);
        next = current;
      } else {
        next = current.replace(new RegExp(`${escapeRegExp(BEGIN)}[\\s\\S]*?${escapeRegExp(END)}`), block);
        writeFile(path, ensureTrailingNewline(next));
        installed.push(`${rel}#adw-workflow`);
      }
    } else {
      next = `${current.trimEnd()}${current.trim() ? '\n\n' : ''}${block}\n`;
      writeFile(path, next);
      installed.push(`${rel}#adw-workflow`);
    }
  }

  return { installed, skipped };
}

function readSkillSource(name: string): string {
  const path = fileURLToPath(new URL(`../../skills/adw-workflow/${name}`, import.meta.url));
  if (!existsSync(path)) {
    throw new SkillInstallError(`找不到 ADW skill 源文件：${path}`, '确认 package 包含 skills/adw-workflow。');
  }
  return readFileSync(path, 'utf8');
}

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, ensureTrailingNewline(content), 'utf8');
}

function ensureTrailingNewline(s: string): string {
  return s.endsWith('\n') ? s : `${s}\n`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
