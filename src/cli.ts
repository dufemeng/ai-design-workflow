#!/usr/bin/env node
import { ConfigError, loadConfig } from './config/index.js';
import { FlowLedgerStore, InvariantError, LedgerError } from './flow/index.js';
import { loadRegistry, RegistryError, type TemplateScenario, TemplateScenarioSchema } from './templates/index.js';
import { retrospect, scanProject } from './scan/index.js';
import { bootstrapDesignLanguage, confirmDesignLanguage, DesignBootstrapError } from './design/index.js';
import { convergence, generateProposalWorkbench, nextDimension, ProposalSpecSchema } from './proposal/index.js';
import { DesignFlowSpecSchema, readinessForCode, writeDesignFlow } from './design-flow/index.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

function scan(targetDir: string): number {
  const { config } = loadConfig(targetDir);
  const s = scanProject(targetDir, config);
  console.log(`项目：${s.purpose.readmeTitle ?? s.techStack.packageName ?? targetDir}`);
  if (s.purpose.readmeSummary) console.log(`简介：${s.purpose.readmeSummary}`);
  console.log(`技术栈：${s.techStack.frameworks.join(', ') || '未识别'}${s.techStack.isMonorepo ? '（monorepo）' : ''}`);
  console.log(`启动：${s.techStack.startCommands.join(' / ') || '未识别'}`);
  console.log(`设计信号：Tailwind=${s.designSignals.hasTailwind} css=${s.designSignals.cssFileCount} token文件=${s.designSignals.tokenFiles.length} components目录=${s.designSignals.componentDirs.length}`);
  const dl = s.designLanguage;
  console.log(`设计语言：DESIGN.md=${dl.hasDesignMd} PRODUCT.md=${dl.hasProductMd} impeccable=${dl.impeccable.present}（critique ${dl.impeccable.critiqueCount} 篇, live=${dl.impeccable.hasLive}）`);
  console.log(`需求级设计文档：${s.designFlows.length} 个 design-<flow>.md（${s.designFlows.filter((f) => f.hasHtml).length} 个有配套 HTML）`);
  return 0;
}

function retrospectCmd(targetDir: string): number {
  const { config } = loadConfig(targetDir);
  const r = retrospect(targetDir, config);
  console.log(`Stage 0 retrospective @ ${targetDir}`);
  console.log(`共 ${r.totals.total} 个 design-<flow> 文档，gap-loop 可跑 ${r.totals.gapLoopReady} 个。\n`);
  for (const f of r.flows) {
    const mark = f.gapLoopReady ? '✓' : '✗';
    console.log(`  ${mark} ${f.slug}${f.missing.length ? `  缺：${f.missing.join('、')}` : ''}`);
  }
  console.log('\n改进清单：');
  for (const item of r.improvementList) console.log(`  - ${item}`);
  console.log(`\n${r.heuristicNote}`);
  return 0;
}

function designBootstrap(rest: string[]): number {
  const refresh = rest.includes('--refresh');
  const targetDir = rest.find((a) => !a.startsWith('--')) ?? process.cwd();
  const { config } = loadConfig(targetDir);
  const r = bootstrapDesignLanguage(targetDir, config, { refresh });
  console.log(`动作：${r.action}`);
  for (const note of r.notes) console.log(`提示：${note}`);
  console.log(`确认页：${r.confirmationPath}`);
  if (r.draftPath) console.log(`草稿：${r.draftPath}`);
  if (r.designVersion) console.log(`designVersion：${r.designVersion}`);
  return 0;
}

function designConfirm(targetDir: string): number {
  const { config } = loadConfig(targetDir);
  try {
    const { designMdPath, designVersion } = confirmDesignLanguage(targetDir, config);
    console.log(`已写入：${designMdPath}`);
    console.log(`designVersion：${designVersion}`);
    return 0;
  } catch (err) {
    if (err instanceof DesignBootstrapError) {
      console.error(`错误：${err.message}`);
      console.error(`怎么修：${err.hint}`);
      return 1;
    }
    throw err;
  }
}

function proposalStatus(targetDir: string, slug: string | undefined): number {
  if (!slug) {
    console.error('用法：adw proposal:status <目标项目目录> <flow-slug>');
    return 2;
  }
  try {
    const { config } = loadConfig(targetDir);
    const ledger = new FlowLedgerStore(targetDir, config.artifactDir).read(slug);
    const conv = convergence(ledger);
    console.log(`探索收敛：${conv.summary}`);
    console.log(`已解决维度：${conv.resolved.join(', ') || '（无）'}`);
    if (conv.canDiverge) {
      console.log('→ 可以进入原型发散（attachPrototype）。');
    } else {
      const next = nextDimension(ledger);
      if (next) {
        console.log(`下一个该问（${next.label}）：${next.question}`);
        console.log(`为什么：${next.why}`);
      }
    }
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

function proposalGenerate(targetDir: string, slug: string | undefined, specPath: string | undefined): number {
  if (!slug || !specPath) {
    console.error('用法：adw proposal:generate <目标项目目录> <flow-slug> <directions.json>');
    return 2;
  }
  const { config } = loadConfig(targetDir);
  const spec = ProposalSpecSchema.parse(JSON.parse(readFileSync(specPath, 'utf8')));
  const { path, count } = generateProposalWorkbench(targetDir, config, slug, spec);
  const relPath = join(config.artifactDir, `proposal-${slug}.html`);
  const store = new FlowLedgerStore(targetDir, config.artifactDir);
  store.apply(slug, { type: 'attachPrototype', htmlPath: relPath, label: `workbench(${count} 方向)` });
  console.log(`已生成原型 workbench：${path}（${count} 个方向），并 attach 到 ledger。`);
  return 0;
}

function proposalApprove(targetDir: string, slug: string | undefined, selection: string | undefined): number {
  if (!slug || !selection) {
    console.error('用法：adw proposal:approve <目标项目目录> <flow-slug> <selection>');
    return 2;
  }
  const { config } = loadConfig(targetDir);
  const store = new FlowLedgerStore(targetDir, config.artifactDir);
  const l = store.apply(slug, { type: 'approvePrototype', selection });
  console.log(`已选定「${selection}」，进入 ${l.currentStage} 阶段。`);
  return 0;
}

function designFlowGenerate(targetDir: string, slug: string | undefined, specPath: string | undefined): number {
  if (!slug || !specPath) {
    console.error('用法：adw design:flow-generate <目标项目目录> <flow-slug> <spec.json>');
    return 2;
  }
  const { config } = loadConfig(targetDir);
  const spec = DesignFlowSpecSchema.parse(JSON.parse(readFileSync(specPath, 'utf8')));
  const { mdPath, htmlPath, mdRel, htmlRel } = writeDesignFlow(targetDir, config, spec);
  console.log(`已生成：${mdPath}`);
  console.log(`已生成：${htmlPath}`);

  const readiness = readinessForCode(spec);
  if (spec.states.length === 0) {
    console.error('挡住了：没有机器可读状态清单，不能进入 Code；已写出产物供补全，但不 attach 到 ledger。');
    return 1;
  }
  const store = new FlowLedgerStore(targetDir, config.artifactDir);
  store.apply(slug, { type: 'attachDesignArtifact', designMd: mdRel, designHtml: htmlRel, designVersion: spec.designVersion });
  if (!readiness.ready) console.log(`提醒：进入 Code 前还缺 ${readiness.missing.join('、')}。`);
  console.log('已 attach 设计稿到 ledger。');
  return 0;
}

function main(argv: string[]): number {
  const command = argv[0];

  try {
    switch (command) {
      case 'proposal:status':
        return proposalStatus(argv[1] ?? process.cwd(), argv[2]);
      case 'proposal:generate':
        return proposalGenerate(argv[1] ?? process.cwd(), argv[2], argv[3]);
      case 'proposal:approve':
        return proposalApprove(argv[1] ?? process.cwd(), argv[2], argv[3]);
      case 'design:flow-generate':
        return designFlowGenerate(argv[1] ?? process.cwd(), argv[2], argv[3]);
      case 'design:bootstrap':
        return designBootstrap(argv.slice(1));
      case 'design:confirm':
        return designConfirm(argv[1] ?? process.cwd());
      case 'config:check':
        return configCheck(argv[1] ?? process.cwd());
      case 'flow:status':
        return flowStatus(argv[1] ?? process.cwd(), argv[2]);
      case 'templates:list':
        return templatesList(argv[1] ?? process.cwd());
      case 'templates:recommend':
        return templatesRecommend(argv[1], argv[2] ?? process.cwd());
      case 'scan':
        return scan(argv[1] ?? process.cwd());
      case 'retrospect':
        return retrospectCmd(argv[1] ?? process.cwd());
      default:
        console.error('用法：adw <config:check|flow:status|templates:*|scan|retrospect|design:bootstrap|design:confirm|proposal:*> ...');
        return 2;
    }
  } catch (err) {
    if (err instanceof RegistryError || err instanceof LedgerError) {
      console.error(`错误：${err.message}`);
      console.error(`怎么修：${err.hint}`);
      return 1;
    }
    if (err instanceof InvariantError) {
      console.error(`挡住了：${err.message}`);
      return 1;
    }
    throw err;
  }
}

process.exit(main(process.argv.slice(2)));
