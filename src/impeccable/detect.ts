import { spawnSync } from 'node:child_process';

export interface ImpeccableDetectFinding {
  antipattern: string;
  severity: string;
  snippet: string;
  file: string | null;
  line: number | null;
  description: string | null;
  name: string | null;
}

export type ImpeccableDetectResult =
  | {
      ok: true;
      source: 'impeccable-detect';
      command: string;
      findings: ImpeccableDetectFinding[];
    }
  | {
      ok: false;
      source: 'impeccable-detect';
      command: string | null;
      reason: 'unavailable' | 'timeout' | 'invalid-json' | 'failed';
      message: string;
      findings: [];
    };

const TIMEOUT_MS = 120_000;

interface CommandCandidate {
  command: string;
  args: string[];
  label: string;
}

function candidates(): CommandCandidate[] {
  const envBin = process.env.ADW_IMPECCABLE_BIN;
  const list: CommandCandidate[] = [];
  if (envBin) list.push({ command: envBin, args: ['detect'], label: `${envBin} detect` });
  list.push({ command: 'impeccable', args: ['detect'], label: 'impeccable detect' });
  list.push({ command: 'npx', args: ['--no-install', 'impeccable', 'detect'], label: 'npx --no-install impeccable detect' });
  return list;
}

export function runImpeccableDetect(target: string, opts: { cwd: string }): ImpeccableDetectResult {
  let lastUnavailable: ImpeccableDetectResult | null = null;

  for (const c of candidates()) {
    const result = spawnSync(c.command, [...c.args, '--json', target], {
      cwd: opts.cwd,
      encoding: 'utf8',
      timeout: TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (result.error) {
      const code = (result.error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        lastUnavailable = {
          ok: false,
          source: 'impeccable-detect',
          command: c.label,
          reason: 'unavailable',
          message: `${c.label} 不可用。安装 impeccable，或设置 ADW_IMPECCABLE_BIN 指向本地 impeccable CLI。`,
          findings: [],
        };
        continue;
      }
      if (code === 'ETIMEDOUT') {
        return {
          ok: false,
          source: 'impeccable-detect',
          command: c.label,
          reason: 'timeout',
          message: `${c.label} 超时（${TIMEOUT_MS}ms）。`,
          findings: [],
        };
      }
      return {
        ok: false,
        source: 'impeccable-detect',
        command: c.label,
        reason: 'failed',
        message: `${c.label} 执行失败：${result.error.message}`,
        findings: [],
      };
    }

    // Impeccable detect exits 2 when it found issues. That is a valid result.
    if (result.status !== 0 && result.status !== 2) {
      return {
        ok: false,
        source: 'impeccable-detect',
        command: c.label,
        reason: 'failed',
        message: `${c.label} 退出码 ${result.status ?? 'unknown'}：${(result.stderr ?? '').trim() || '无 stderr'}`,
        findings: [],
      };
    }

    const parsed = parseFindings(result.stdout ?? '');
    if (!parsed.ok) {
      return {
        ok: false,
        source: 'impeccable-detect',
        command: c.label,
        reason: 'invalid-json',
        message: `${c.label} 输出不是合法 findings JSON：${parsed.message}`,
        findings: [],
      };
    }

    return {
      ok: true,
      source: 'impeccable-detect',
      command: c.label,
      findings: parsed.findings,
    };
  }

  return (
    lastUnavailable ?? {
      ok: false,
      source: 'impeccable-detect',
      command: null,
      reason: 'unavailable',
      message: '没有可用的 impeccable detect CLI。',
      findings: [],
    }
  );
}

function parseFindings(stdout: string): { ok: true; findings: ImpeccableDetectFinding[] } | { ok: false; message: string } {
  const text = stdout.trim();
  if (!text) return { ok: false, message: 'stdout 为空' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
  if (!Array.isArray(raw)) return { ok: false, message: '顶层 JSON 不是数组' };
  return { ok: true, findings: raw.map(normalizeFinding) };
}

function normalizeFinding(value: unknown): ImpeccableDetectFinding {
  const item = isRecord(value) ? value : {};
  return {
    antipattern: asString(item.antipattern) ?? 'unknown-antipattern',
    severity: asString(item.severity) ?? 'warning',
    snippet: asString(item.snippet) ?? '',
    file: asString(item.file),
    line: asNumber(item.line),
    description: asString(item.description),
    name: asString(item.name),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function formatImpeccableFinding(f: ImpeccableDetectFinding): string {
  const loc = f.file ? `${f.file}${f.line ? `:${f.line}` : ''}` : null;
  const detail = f.snippet || f.description || f.name || 'no snippet';
  return `[${f.antipattern}/${f.severity}] ${detail}${loc ? ` (${loc})` : ''}`;
}

export function hasBlockingDetectorFinding(findings: ImpeccableDetectFinding[]): boolean {
  return findings.some((f) => f.severity !== 'advisory');
}
