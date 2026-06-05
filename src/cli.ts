#!/usr/bin/env node
import { ConfigError, loadConfig } from './config/index.js';
import { FlowLedgerStore, LedgerError } from './flow/index.js';
import { loadRegistry, RegistryError, type TemplateScenario, TemplateScenarioSchema } from './templates/index.js';

function configCheck(targetDir: string): number {
  try {
    const result = loadConfig(targetDir);
    console.log(`目标项目：${targetDir}`);
    console.log(`配置来源：${result.source}${result.configPath ? ` (${result.configPath})` : ''}`);
    for (const note of result.notes) console.log(`提示：${note}`);
    console.log('解析后的配置：');
    console.log(JSON.stringify(result.config, null, 2));
    return 0;
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`配置错误：${err.message}`);
      console.error(`怎么修：${err.hint}`);
      return 1;
    }
    throw err;
  }
}

function flowStatus(targetDir: string, slug: string | undefined): number {
  if (!slug) {
    console.error('用法：adw flow:status <目标项目目录> <flow-slug>');
    return 2;
  }
  try {
    const { config } = loadConfig(targetDir);
    const store = new FlowLedgerStore(targetDir, config.artifactDir);
    const s = store.status(slug);
    console.log(`当前步骤：${s.step}`);
    console.log(`现在要决定：${s.decideNow}`);
    console.log(`已有产物：${s.artifacts.length > 0 ? s.artifacts.join('；') : '（无）'}`);
    if (s.blockedReason) console.log(`为什么不能继续：${s.blockedReason}`);
    return 0;
  } catch (err) {
    if (err instanceof LedgerError) {
      console.error(`错误：${err.message}`);
      console.error(`怎么修：${err.hint}`);
      return 1;
    }
    throw err;
  }
}

function templatesList(targetDir: string): number {
  const { config } = loadConfig(targetDir);
  const { registry, source, notes } = loadRegistry(config.templateRegistry, targetDir);
  console.log(`模板源：${source}（root: ${registry.root}）`);
  for (const note of notes) console.log(`提示：${note}`);
  for (const t of registry.list()) {
    console.log(`  ${t.id}  [${t.scenario}/${t.surface}]  ${t.name} — ${t.description}`);
  }
  return 0;
}

function templatesRecommend(scenarioArg: string | undefined, targetDir: string): number {
  const parsed = TemplateScenarioSchema.safeParse(scenarioArg);
  if (!parsed.success) {
    console.error(`未知场景「${scenarioArg ?? ''}」。可选：${TemplateScenarioSchema.options.join(', ')}`);
    return 2;
  }
  const scenario: TemplateScenario = parsed.data;
  const { config } = loadConfig(targetDir);
  const { registry } = loadRegistry(config.templateRegistry, targetDir);
  const recs = registry.recommend(scenario);
  console.log(`场景「${scenario}」推荐模板：`);
  for (const t of recs) console.log(`  ${t.id} — ${t.name}`);
  return 0;
}

function main(argv: string[]): number {
  const command = argv[0];

  try {
    switch (command) {
      case 'config:check':
        return configCheck(argv[1] ?? process.cwd());
      case 'flow:status':
        return flowStatus(argv[1] ?? process.cwd(), argv[2]);
      case 'templates:list':
        return templatesList(argv[1] ?? process.cwd());
      case 'templates:recommend':
        return templatesRecommend(argv[1], argv[2] ?? process.cwd());
      default:
        console.error('用法：adw <config:check|flow:status|templates:list|templates:recommend> ...');
        return 2;
    }
  } catch (err) {
    if (err instanceof RegistryError) {
      console.error(`模板错误：${err.message}`);
      console.error(`怎么修：${err.hint}`);
      return 1;
    }
    throw err;
  }
}

process.exit(main(process.argv.slice(2)));
