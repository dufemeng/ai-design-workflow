import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { z } from 'zod';
import type { TemplateRegistry as TemplateRegistryConfig } from '../config/schema.js';
import {
  REGISTRY_MANIFEST_FILENAME,
  RegistryManifestSchema,
  SCENARIO_RECOMMENDATIONS,
  type TemplateEntry,
  type TemplateScenario,
} from './schema.js';

export class RegistryError extends Error {
  constructor(
    message: string,
    readonly hint: string,
  ) {
    super(message);
    this.name = 'RegistryError';
  }
}

/** 内置 registry 根目录：产品自带的静态模板，永远可用，作为兜底。 */
const BUILTIN_ROOT = fileURLToPath(new URL('../../templates/', import.meta.url));

export type SelectResult =
  | { kind: 'template'; id: string; shellPath: string }
  | { kind: 'fallback'; fallbackShell: string };

/** 已加载的模板 registry（某个 root 下一组校验过的模板）。 */
export class TemplateRegistry {
  constructor(
    readonly root: string,
    private readonly entries: TemplateEntry[],
  ) {}

  list(): TemplateEntry[] {
    return [...this.entries];
  }

  get(id: string): TemplateEntry {
    const entry = this.entries.find((t) => t.id === id);
    if (!entry) {
      throw new RegistryError(
        `模板「${id}」不在 registry 里。`,
        `可用模板：${this.entries.map((t) => t.id).join(', ')}。`,
      );
    }
    return entry;
  }

  /** 按场景推荐（有序）。registry 里缺的推荐 id 会被跳过。 */
  recommend(scenario: TemplateScenario): TemplateEntry[] {
    return SCENARIO_RECOMMENDATIONS[scenario]
      .map((id) => this.entries.find((t) => t.id === id))
      .filter((t): t is TemplateEntry => t !== undefined);
  }

  /** shell 的绝对路径，给生成阶段当静态底座用。 */
  shellAbsPath(id: string): string {
    return join(this.root, this.get(id).shellPath);
  }

  /**
   * T2 硬约束：生成 HTML 前必须「选一个模板」或「显式声明 fallback shell」，
   * 二者都没有就报错，不允许凭空裸排版。
   * 优先级：overrideId（用户覆盖推荐） > scenario（系统推荐） > fallbackShell。
   */
  selectTemplate(opts: { scenario?: TemplateScenario; overrideId?: string; fallbackShell?: string }): SelectResult {
    if (opts.overrideId) {
      const entry = this.get(opts.overrideId);
      return { kind: 'template', id: entry.id, shellPath: this.shellAbsPath(entry.id) };
    }
    if (opts.scenario) {
      const recommended = this.recommend(opts.scenario)[0];
      if (!recommended) {
        throw new RegistryError(
          `场景「${opts.scenario}」没有可用推荐模板。`,
          '给一个 overrideId，或显式声明 fallbackShell。',
        );
      }
      return { kind: 'template', id: recommended.id, shellPath: this.shellAbsPath(recommended.id) };
    }
    if (opts.fallbackShell) {
      return { kind: 'fallback', fallbackShell: opts.fallbackShell };
    }
    throw new RegistryError(
      '生成 HTML 前必须选择一个模板（给 scenario 或 overrideId），或显式声明 fallbackShell。',
      '调用方需要做出选择，系统不允许无模板裸排版。',
    );
  }
}

export interface LoadRegistryResult {
  registry: TemplateRegistry;
  source: 'configured' | 'builtin';
  notes: string[];
}

/**
 * 按 config 加载模板 registry：先试配置的源（path / package），
 * 不可用就兜底到内置 registry 并给提示。
 */
export function loadRegistry(config: TemplateRegistryConfig, targetProjectDir: string): LoadRegistryResult {
  const notes: string[] = [];
  const configuredRoot = resolveConfiguredRoot(config, targetProjectDir);

  if (configuredRoot) {
    const manifestPath = join(configuredRoot, REGISTRY_MANIFEST_FILENAME);
    if (existsSync(manifestPath)) {
      const loaded = tryLoadManifest(configuredRoot);
      if (loaded.ok) {
        return { registry: new TemplateRegistry(configuredRoot, loaded.entries), source: 'configured', notes };
      }
      notes.push(`配置的模板源 ${manifestPath} 不可用（${loaded.reason}），已回退到内置模板。`);
    } else {
      notes.push(`配置的模板源 ${configuredRoot} 没有 ${REGISTRY_MANIFEST_FILENAME}，已回退到内置模板。`);
    }
  } else {
    notes.push(`无法解析配置的模板源（${config.type}:${config.value}），已回退到内置模板。`);
  }

  const builtin = tryLoadManifest(BUILTIN_ROOT);
  if (!builtin.ok) {
    throw new RegistryError(`内置模板 registry 损坏：${builtin.reason}`, '这是产品自带数据问题，请检查 templates/ 目录。');
  }
  return { registry: new TemplateRegistry(BUILTIN_ROOT, builtin.entries), source: 'builtin', notes };
}

function resolveConfiguredRoot(config: TemplateRegistryConfig, targetProjectDir: string): string | null {
  if (config.type === 'path') {
    return isAbsolute(config.value) ? config.value : resolve(targetProjectDir, config.value);
  }
  // package：尝试解析 `${pkg}/adw-registry.json`，解析不到就交给兜底。
  try {
    const require = createRequire(import.meta.url);
    return dirname(require.resolve(`${config.value}/${REGISTRY_MANIFEST_FILENAME}`));
  } catch {
    return null;
  }
}

type ManifestLoad = { ok: true; entries: TemplateEntry[] } | { ok: false; reason: string };

function tryLoadManifest(root: string): ManifestLoad {
  const manifestPath = join(root, REGISTRY_MANIFEST_FILENAME);
  if (!existsSync(manifestPath)) return { ok: false, reason: `找不到 ${REGISTRY_MANIFEST_FILENAME}` };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    return { ok: false, reason: `manifest 不是合法 JSON：${(err as Error).message}` };
  }
  const parsed = RegistryManifestSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: `manifest 结构非法：${formatIssues(parsed.error)}` };
  }
  // 每个 shell 文件必须存在，否则「能当静态文件打开」无从谈起。
  for (const entry of parsed.data.templates) {
    if (!existsSync(join(root, entry.shellPath))) {
      return { ok: false, reason: `模板「${entry.id}」的 shell 缺失：${entry.shellPath}` };
    }
  }
  return { ok: true, entries: parsed.data.templates };
}

function formatIssues(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
}
