import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { z } from 'zod';
import { type AdwConfig, ConfigSchema } from './schema.js';

export const CONFIG_FILENAME = 'ai-design-workflow.config.json';

/** 配置非法时抛出，带「怎么修」的人话提示（T0 验收：配置缺失/错误给可执行修复提示）。 */
export class ConfigError extends Error {
  constructor(
    message: string,
    readonly hint: string,
  ) {
    super(message);
    this.name = 'ConfigError';
  }
}

export interface LoadConfigResult {
  config: AdwConfig;
  /** file：读到了 config 文件；defaults：目标项目没有 config，用默认值。 */
  source: 'file' | 'defaults';
  configPath: string | null;
  /** 非阻塞提示，例如「用了默认值」「绝对路径不可移植」。 */
  notes: string[];
}

/**
 * 从「目标项目目录」加载配置。注意：config 属于被加工的目标项目，不属于本产品仓库。
 */
export function loadConfig(targetProjectDir: string): LoadConfigResult {
  const configPath = join(targetProjectDir, CONFIG_FILENAME);
  const notes: string[] = [];

  if (!existsSync(configPath)) {
    notes.push(
      `未找到 ${CONFIG_FILENAME}，已使用默认配置。如需自定义，在目标项目根目录创建 ${CONFIG_FILENAME}（字段见 ai-design-workflow.config.example.json）。`,
    );
    return { config: ConfigSchema.parse({}), source: 'defaults', configPath: null, notes };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (err) {
    throw new ConfigError(
      `${CONFIG_FILENAME} 不是合法 JSON：${(err as Error).message}`,
      `检查 ${configPath} 的 JSON 语法（逗号、引号、括号是否配对）。`,
    );
  }

  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ConfigError(
      `${CONFIG_FILENAME} 校验失败：\n${formatIssues(parsed.error)}`,
      `按上面每条 path 修正对应字段后重试；字段说明见 ai-design-workflow.config.example.json。`,
    );
  }

  const config = parsed.data;

  // 可移植性：path 类型模板仓库用本机绝对路径会绑死机器，提醒但不阻塞。
  if (config.templateRegistry.type === 'path' && isAbsolute(config.templateRegistry.value)) {
    notes.push(
      `templateRegistry 用了本机绝对路径（${config.templateRegistry.value}），换机器会失效；改成相对目标项目的路径或 package id 才能跨项目复用。`,
    );
  }

  return { config, source: 'file', configPath, notes };
}

function formatIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`).join('\n');
}
