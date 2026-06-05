import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AdwConfig } from '../config/schema.js';
import { scanProject } from './scanner.js';

/**
 * Stage 0 retrospective：抽样回顾目标项目已有的 design-<flow>.md，逐个判断
 * 缺没缺「目标 route / 机器可读状态清单 / 验收规则 / HTML 设计稿」，产出可执行改进清单。
 *
 * 注意：这里是启发式检查（关键词 / 模式），只负责把候选问题摆出来给人确认，
 * 不替代判断层；判断「真缺」还是「换了说法」由人复核。
 */

export interface FlowAssessment {
  slug: string;
  mdPath: string;
  hasHtml: boolean;
  hasTargetRoute: boolean;
  hasStateList: boolean;
  hasAcceptance: boolean;
  gapLoopReady: boolean;
  missing: string[];
}

export interface RetrospectiveReport {
  targetDir: string;
  flows: FlowAssessment[];
  totals: {
    total: number;
    gapLoopReady: number;
    missingRoute: number;
    missingStates: number;
    missingAcceptance: number;
    missingHtml: number;
  };
  improvementList: string[];
  heuristicNote: string;
}

const STATE_KEYWORDS = ['空', '加载', '错误', '成功', '边界', 'empty', 'loading', 'error'];
// gap-loop 需要的是「刻意声明、机器能找到」的目标 route，不是正文里随手出现的路径。
// 因此只认两种：带标签（route: / 路由：/ url:）或反引号包起来的路径。
const ROUTE_LABELED = /(目标\s*)?(route|路由|url)\s*[：:]/i;
const ROUTE_IN_CODE = /`\/[a-z][\w/:-]*`/;

function hasTargetRoute(content: string): boolean {
  return ROUTE_LABELED.test(content) || ROUTE_IN_CODE.test(content);
}

function hasStateList(content: string): boolean {
  const distinct = new Set(STATE_KEYWORDS.filter((k) => content.includes(k)));
  return distinct.size >= 3;
}

function hasAcceptance(content: string): boolean {
  return /验收|acceptance/i.test(content);
}

export function retrospect(targetDir: string, config: AdwConfig): RetrospectiveReport {
  const snapshot = scanProject(targetDir, config);
  const flows: FlowAssessment[] = [];

  for (const flow of snapshot.designFlows) {
    let content = '';
    try {
      content = readFileSync(join(targetDir, flow.mdPath), 'utf8');
    } catch {
      content = '';
    }
    const route = hasTargetRoute(content);
    const states = hasStateList(content);
    const acceptance = hasAcceptance(content);
    const missing: string[] = [];
    if (!route) missing.push('目标 route');
    if (!states) missing.push('机器可读状态清单');
    if (!acceptance) missing.push('验收规则');
    if (!flow.hasHtml) missing.push('HTML 设计稿');

    flows.push({
      slug: flow.slug,
      mdPath: flow.mdPath,
      hasHtml: flow.hasHtml,
      hasTargetRoute: route,
      hasStateList: states,
      hasAcceptance: acceptance,
      gapLoopReady: route && states && acceptance && flow.hasHtml,
      missing,
    });
  }

  const totals = {
    total: flows.length,
    gapLoopReady: flows.filter((f) => f.gapLoopReady).length,
    missingRoute: flows.filter((f) => !f.hasTargetRoute).length,
    missingStates: flows.filter((f) => !f.hasStateList).length,
    missingAcceptance: flows.filter((f) => !f.hasAcceptance).length,
    missingHtml: flows.filter((f) => !f.hasHtml).length,
  };

  const improvementList: string[] = [];
  const slugsOf = (pred: (f: FlowAssessment) => boolean): string =>
    flows
      .filter(pred)
      .map((f) => f.slug)
      .slice(0, 8)
      .join(', ');

  if (totals.missingRoute > 0)
    improvementList.push(`${totals.missingRoute} 个文档缺目标 route（gap loop 不知道去哪个页面比）：${slugsOf((f) => !f.hasTargetRoute)}`);
  if (totals.missingStates > 0)
    improvementList.push(`${totals.missingStates} 个文档缺机器可读状态清单（state coverage 无从检查）：${slugsOf((f) => !f.hasStateList)}`);
  if (totals.missingAcceptance > 0)
    improvementList.push(`${totals.missingAcceptance} 个文档缺验收规则：${slugsOf((f) => !f.hasAcceptance)}`);
  if (totals.missingHtml > 0)
    improvementList.push(`${totals.missingHtml} 个文档缺 HTML 设计稿（没有 gap baseline）：${slugsOf((f) => !f.hasHtml)}`);
  improvementList.push(`${totals.total} 个 design-<flow> 文档中，${totals.gapLoopReady} 个达到 gap loop 可跑标准（route + 状态 + 验收 + HTML 齐全）。`);

  return {
    targetDir,
    flows,
    totals,
    improvementList,
    heuristicNote: '以上为启发式检查（关键词/模式匹配），用于摆出候选缺口；是否真缺由人复核，meta 文档天然没有 route/状态属正常。',
  };
}
