#!/usr/bin/env node
import { ConfigError, loadConfig } from './config/index.js';
import { ExplorationDimensionSchema, FlowLedgerStore, InvariantError, LedgerError } from './flow/index.js';
import { loadRegistry, RegistryError, type TemplateScenario, TemplateScenarioSchema } from './templates/index.js';
import { retrospect, scanProject } from './scan/index.js';
import { bootstrapDesignLanguage, confirmDesignLanguage, DesignBootstrapError, confirmDesignDelta, DesignDeltaError, DesignDeltaInputSchema, proposeDesignDelta } from './design/index.js';
import { ZodError } from 'zod';
import { convergence, generateProposalWorkbench, nextDimension, ProposalSpecSchema } from './proposal/index.js';
import { DesignFlowSpecSchema, readinessForCode, writeDesignFlow } from './design-flow/index.js';
import { JudgmentInputSchema, ReviewError, runReviewGate } from './review/index.js';
import { assembleCodeContext, CodeContextError } from './code/index.js';
import { GapReportSchema, runGapLoop } from './gap/index.js';
import { AUTOFIX_CONTRACT, splitFindings } from './autofix/index.js';
import { generateLiveWorkbench, liveMetrics, LiveError } from './live/index.js';
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

function flowCreate(targetDir: string, slug: string | undefined, title: string | undefined): number {
  if (!slug || !title) {
    console.error('用法：adw flow:create <目标项目目录> <flow-slug> <用户可读标题>');
    return 2;
  }
  const { config } = loadConfig(targetDir);
  const ledger = new FlowLedgerStore(targetDir, config.artifactDir).create({ slug, title });
  console.log(`已创建 flow「${ledger.title}」（${slug}）。`);
  console.log(`下一步：${ledger.resumePointer.hint}`);
  return 0;
}

function flowDone(targetDir: string, slug: string | undefined, flags: string[]): number {
  if (!slug) {
    console.error('用法：adw flow:done <目标项目目录> <flow-slug> [--accept-warnings]');
    return 2;
  }
  const { config } = loadConfig(targetDir);
  const acceptRemainingWarnings = flags.includes('--accept-warnings');
  const l = new FlowLedgerStore(targetDir, config.artifactDir).apply(slug, { type: 'markDone', acceptRemainingWarnings });
  console.log(`flow「${l.title}」已标记完成：设计产物与实现页面对齐。`);
  return 0;
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

function proposalAnswer(targetDir: string, slug: string | undefined, question: string | undefined, answer: string | undefined, flags: string[]): number {
  if (!slug || !question || !answer) {
    console.error('用法：adw proposal:answer <目标项目目录> <flow-slug> <问题> <回答> [--assumption 假设] [--resolved 已解决问题] [--new-open 新开问题] [--dimension target-user|core-scenario|main-path|key-states|constraints|success-criteria]');
    return 2;
  }
  const { config } = loadConfig(targetDir);
  const flag = (name: string): string | undefined => {
    const i = flags.indexOf(name);
    return i >= 0 ? flags[i + 1] : undefined;
  };
  const dimRaw = flag('--dimension');
  const resolvesDimension = dimRaw ? ExplorationDimensionSchema.parse(dimRaw) : undefined;
  const l = new FlowLedgerStore(targetDir, config.artifactDir).apply(slug, {
    type: 'recordQuestionAnswer',
    question,
    answer,
    assumption: flag('--assumption'),
    resolvedQuestion: flag('--resolved'),
    newOpenQuestion: flag('--new-open'),
    resolvesDimension,
  });
  const conv = convergence(l);
  console.log(`已记录问答。探索收敛：${conv.summary}`);
  return 0;
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

function designReview(targetDir: string, slug: string | undefined, judgmentPath: string | undefined): number {
  if (!slug) {
    console.error('用法：adw design:review <目标项目目录> <flow-slug> [judgment.json]');
    return 2;
  }
  const { config } = loadConfig(targetDir);
  const judgment = judgmentPath ? JudgmentInputSchema.parse(JSON.parse(readFileSync(judgmentPath, 'utf8'))) : { findings: [] };
  try {
    const r = runReviewGate(targetDir, config, slug, judgment);
    console.log(`审查结果：${r.passed ? '通过' : '阻塞'}　参考分：${r.score}/40`);
    if (r.blockingReasons.length) {
      console.log('阻塞原因：');
      for (const reason of r.blockingReasons) console.log(`  - ${reason}`);
    }
    if (r.judgment.fatalWithoutEvidence.length) {
      console.log(`（${r.judgment.fatalWithoutEvidence.length} 条致命意见因缺证据被忽略，补证据才算数）`);
    }
    console.log(`报告：${r.reportPath}`);
    return r.passed ? 0 : 1;
  } catch (err) {
    if (err instanceof ReviewError) {
      console.error(`错误：${err.message}`);
      console.error(`怎么修：${err.hint}`);
      return 1;
    }
    throw err;
  }
}

function designApprove(targetDir: string, slug: string | undefined): number {
  if (!slug) {
    console.error('用法：adw design:approve <目标项目目录> <flow-slug>');
    return 2;
  }
  const { config } = loadConfig(targetDir);
  const l = new FlowLedgerStore(targetDir, config.artifactDir).apply(slug, { type: 'approveDesign' });
  console.log(`已批准设计，进入 ${l.currentStage} 阶段。下一步：${l.resumePointer.hint}`);
  return 0;
}

function codeContext(targetDir: string, slug: string | undefined): number {
  if (!slug) {
    console.error('用法：adw code:context <目标项目目录> <flow-slug>');
    return 2;
  }
  const { config } = loadConfig(targetDir);
  try {
    const ctx = assembleCodeContext(targetDir, config, slug);
    console.log(`flow：${slug}`);
    console.log(`目标 route：${ctx.targetRoute ?? '（未指定）'}`);
    console.log(`设计稿：${ctx.designHtmlRel}（DESIGN.md@${ctx.designVersion ?? '—'}）`);
    console.log(`屏幕 ${ctx.spec.screens.length} / 状态 ${ctx.spec.states.length} / 验收 ${ctx.spec.acceptanceRules.length}`);
    console.log(`实现目标：${ctx.implementationTarget ? `${ctx.implementationTarget.route}${ctx.implementationTarget.needsAuthedSession ? '（需登录会话）' : ''}` : '（未设定，先 code:target）'}`);
    return 0;
  } catch (err) {
    if (err instanceof CodeContextError) {
      console.error(`错误：${err.message}`);
      console.error(`怎么修：${err.hint}`);
      return 1;
    }
    throw err;
  }
}

function codeTarget(targetDir: string, slug: string | undefined, route: string | undefined, flags: string[]): number {
  if (!slug || !route) {
    console.error('用法：adw code:target <目标项目目录> <flow-slug> <route/URL> [--no-auth]');
    return 2;
  }
  const { config } = loadConfig(targetDir);
  const needsAuthedSession = !flags.includes('--no-auth');
  new FlowLedgerStore(targetDir, config.artifactDir).apply(slug, { type: 'attachImplementationTarget', route, needsAuthedSession });
  console.log(`已设定实现目标：${route}${needsAuthedSession ? '（gap 复用已登录会话）' : ''}`);
  return 0;
}

async function gapRun(targetDir: string, slug: string | undefined, url: string | undefined, flags: string[]): Promise<number> {
  if (!slug || !url) {
    console.error('用法：adw gap:run <目标项目目录> <flow-slug> <实现页面 URL> [--storage storageState.json]');
    return 2;
  }
  const { config } = loadConfig(targetDir);
  const sIdx = flags.indexOf('--storage');
  const storageStatePath = sIdx >= 0 ? flags[sIdx + 1] : undefined;
  const { report, attached } = await runGapLoop(targetDir, config, slug, { url, storageStatePath });
  console.log(`采集：${report.captureStatus}　阻塞 ${report.blockingCount} / 提醒 ${report.warningCount}${attached ? '（已 attach ledger）' : '（未 attach）'}`);
  for (const c of report.checks) console.log(`  ${c.check}${c.source ? `(${c.source})` : ''}: ${c.status}${c.findings.length ? ` — ${c.findings.join('；')}` : ''}`);
  if (report.note) console.log(`note：${report.note}`);
  if (report.captureStatus === 'failed') return 1;
  return report.blockingCount > 0 ? 1 : 0;
}

function autofixPlan(targetDir: string, slug: string | undefined): number {
  if (!slug) {
    console.error('用法：adw gap:autofix-plan <目标项目目录> <flow-slug>');
    return 2;
  }
  const { config } = loadConfig(targetDir);
  const ledger = new FlowLedgerStore(targetDir, config.artifactDir).read(slug);
  const lastRef = ledger.artifactRefs.gapReports.at(-1);
  if (!lastRef) {
    console.error('还没有 gap 报告，先跑 gap:run。');
    return 1;
  }
  const report = GapReportSchema.parse(JSON.parse(readFileSync(join(targetDir, lastRef), 'utf8')));
  const split = splitFindings(report.checks);
  console.log(`最新 gap：阻塞 ${report.blockingCount} / 提醒 ${report.warningCount}`);
  console.log(`可自动修复（${split.autoFixable.length}）：${split.autoFixable.map((c) => c.check).join(', ') || '无'}`);
  console.log(`转人工 live（${split.toLive.length}）：${split.toLive.map((c) => c.check).join(', ') || '无'}`);
  console.log('自动修复安全契约：');
  for (const r of AUTOFIX_CONTRACT) console.log(`  - ${r}`);
  return 0;
}

function designmdProposeDelta(targetDir: string, inputPath: string | undefined): number {
  if (!inputPath) {
    console.error('用法：adw designmd:propose-delta <目标项目目录> <delta-input.json>');
    return 2;
  }
  const { config } = loadConfig(targetDir);
  const input = DesignDeltaInputSchema.parse(JSON.parse(readFileSync(inputPath, 'utf8')));
  try {
    const { proposalPath, confirmationPath } = proposeDesignDelta(targetDir, config, input);
    console.log(`已生成 DESIGN.md 变更提案：${proposalPath}`);
    console.log(`确认页：${confirmationPath}`);
    console.log('未改 DESIGN.md。确认请跑 designmd:confirm-delta。');
    return 0;
  } catch (err) {
    if (err instanceof DesignDeltaError) {
      console.error(`错误：${err.message}`);
      console.error(`怎么修：${err.hint}`);
      return 1;
    }
    throw err;
  }
}

function designmdConfirmDelta(targetDir: string, id: string | undefined): number {
  if (!id) {
    console.error('用法：adw designmd:confirm-delta <目标项目目录> <delta-id>');
    return 2;
  }
  const { config } = loadConfig(targetDir);
  try {
    const { designMdPath, designVersion } = confirmDesignDelta(targetDir, config, id);
    console.log(`已写入 DESIGN.md：${designMdPath}`);
    console.log(`新 designVersion：${designVersion}（需求级文档应引用这个版本）`);
    return 0;
  } catch (err) {
    if (err instanceof DesignDeltaError) {
      console.error(`错误：${err.message}`);
      console.error(`怎么修：${err.hint}`);
      return 1;
    }
    throw err;
  }
}

function liveWorkbench(targetDir: string, slug: string | undefined): number {
  if (!slug) {
    console.error('用法：adw live:workbench <目标项目目录> <flow-slug>');
    return 2;
  }
  const { config } = loadConfig(targetDir);
  try {
    const { path, problemCount } = generateLiveWorkbench(targetDir, config, slug);
    console.log(`已生成 live workbench：${path}（${problemCount} 个待处理问题）`);
    return 0;
  } catch (err) {
    if (err instanceof LiveError) {
      console.error(`错误：${err.message}`);
      console.error(`怎么修：${err.hint}`);
      return 1;
    }
    throw err;
  }
}

function liveRecord(targetDir: string, slug: string | undefined, purpose: string | undefined, flags: string[]): number {
  if (!slug || !purpose) {
    console.error('用法：adw live:record <目标项目目录> <flow-slug> <改动目的> [--scope X] [--rule R] [--duration ms] [--result accepted|rejected|abandoned] [--no-reverify]');
    return 2;
  }
  const getFlag = (name: string): string | undefined => {
    const i = flags.indexOf(name);
    return i >= 0 ? flags[i + 1] : undefined;
  };
  const resultRaw = getFlag('--result');
  if (resultRaw && !['accepted', 'rejected', 'abandoned'].includes(resultRaw)) {
    console.error(`--result 只能是 accepted / rejected / abandoned，收到「${resultRaw}」。`);
    return 2;
  }
  const durationRaw = getFlag('--duration');
  const durationMs = durationRaw && Number.isFinite(Number(durationRaw)) ? Number(durationRaw) : null;
  const needsReverify = !flags.includes('--no-reverify');
  const { config } = loadConfig(targetDir);
  new FlowLedgerStore(targetDir, config.artifactDir).apply(slug, {
    type: 'recordPatchIntent',
    intent: {
      source: 'live',
      purpose,
      scope: getFlag('--scope') ?? 'live',
      relatedRule: getFlag('--rule') ?? null,
      needsReverify,
      durationMs,
      result: (resultRaw as 'accepted' | 'rejected' | 'abandoned' | undefined) ?? null,
    },
  });
  console.log(`已记录 live PatchIntent：${purpose}`);
  if (needsReverify) console.log('提醒：接受了改动，记得 gap:run 复验相关检查。');
  return 0;
}

function liveMetricsCmd(targetDir: string, slug: string | undefined): number {
  if (!slug) {
    console.error('用法：adw live:metrics <目标项目目录> <flow-slug>');
    return 2;
  }
  const { config } = loadConfig(targetDir);
  const ledger = new FlowLedgerStore(targetDir, config.artifactDir).read(slug);
  const m = liveMetrics(ledger.patchIntentHistory);
  console.log(`live 修改：${m.count} 次（接受 ${m.accepted} / 拒绝 ${m.rejected} / 放弃 ${m.abandoned}）`);
  console.log(`返工率：${(m.reworkRate * 100).toFixed(0)}%　平均耗时：${m.avgDurationMs ?? '—'}ms　待复验：${m.needReverify}`);
  return 0;
}

async function main(argv: string[]): Promise<number> {
  const command = argv[0];

  try {
    switch (command) {
      case 'designmd:propose-delta':
        return designmdProposeDelta(argv[1] ?? process.cwd(), argv[2]);
      case 'designmd:confirm-delta':
        return designmdConfirmDelta(argv[1] ?? process.cwd(), argv[2]);
      case 'live:workbench':
        return liveWorkbench(argv[1] ?? process.cwd(), argv[2]);
      case 'live:record':
        return liveRecord(argv[1] ?? process.cwd(), argv[2], argv[3], argv.slice(4));
      case 'live:metrics':
        return liveMetricsCmd(argv[1] ?? process.cwd(), argv[2]);
      case 'gap:autofix-plan':
        return autofixPlan(argv[1] ?? process.cwd(), argv[2]);
      case 'code:context':
        return codeContext(argv[1] ?? process.cwd(), argv[2]);
      case 'code:target':
        return codeTarget(argv[1] ?? process.cwd(), argv[2], argv[3], argv.slice(4));
      case 'gap:run':
        return await gapRun(argv[1] ?? process.cwd(), argv[2], argv[3], argv.slice(4));
      case 'proposal:answer':
        return proposalAnswer(argv[1] ?? process.cwd(), argv[2], argv[3], argv[4], argv.slice(5));
      case 'proposal:status':
        return proposalStatus(argv[1] ?? process.cwd(), argv[2]);
      case 'proposal:generate':
        return proposalGenerate(argv[1] ?? process.cwd(), argv[2], argv[3]);
      case 'proposal:approve':
        return proposalApprove(argv[1] ?? process.cwd(), argv[2], argv[3]);
      case 'design:flow-generate':
        return designFlowGenerate(argv[1] ?? process.cwd(), argv[2], argv[3]);
      case 'design:review':
        return designReview(argv[1] ?? process.cwd(), argv[2], argv[3]);
      case 'design:approve':
        return designApprove(argv[1] ?? process.cwd(), argv[2]);
      case 'design:bootstrap':
        return designBootstrap(argv.slice(1));
      case 'design:confirm':
        return designConfirm(argv[1] ?? process.cwd());
      case 'config:check':
        return configCheck(argv[1] ?? process.cwd());
      case 'flow:create':
        return flowCreate(argv[1] ?? process.cwd(), argv[2], argv[3]);
      case 'flow:status':
        return flowStatus(argv[1] ?? process.cwd(), argv[2]);
      case 'flow:done':
        return flowDone(argv[1] ?? process.cwd(), argv[2], argv.slice(3));
      case 'templates:list':
        return templatesList(argv[1] ?? process.cwd());
      case 'templates:recommend':
        return templatesRecommend(argv[1], argv[2] ?? process.cwd());
      case 'scan':
        return scan(argv[1] ?? process.cwd());
      case 'retrospect':
        return retrospectCmd(argv[1] ?? process.cwd());
      default:
        console.error('用法：adw <config:check|flow:create|flow:status|flow:done|scan|retrospect|templates:*|proposal:*|design:bootstrap|design:confirm|design:flow-generate|design:review|designmd:propose-delta|designmd:confirm-delta|code:*|gap:run|gap:autofix-plan|live:*> ...');
        return 2;
    }
  } catch (err) {
    if (err instanceof RegistryError || err instanceof LedgerError || err instanceof CodeContextError) {
      console.error(`错误：${err.message}`);
      console.error(`怎么修：${err.hint}`);
      return 1;
    }
    if (err instanceof InvariantError) {
      console.error(`挡住了：${err.message}`);
      return 1;
    }
    if (err instanceof ZodError) {
      console.error('输入校验失败：');
      for (const issue of err.issues) console.error(`  - ${issue.path.join('.') || '(root)'}: ${issue.message}`);
      return 1;
    }
    throw err;
  }
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
