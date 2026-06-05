import type { ExplorationDimension, FlowGate, FlowLedger, FlowStage, PatchIntent } from './schema.js';

/**
 * 状态推进 action（tasks 5.3）。大模型不能「凭记忆」推进阶段，
 * 只能走这些显式 action；每个 action 前跑 invariant，挡住跳步和编造产物。
 */

export interface PatchIntentInput {
  source: PatchIntent['source'];
  purpose: string;
  scope: string;
  relatedRule?: string | null;
  needsReverify: boolean;
  durationMs?: number | null;
  result?: PatchIntent['result'];
}

export type FlowAction =
  | { type: 'recordQuestionAnswer'; question: string; answer: string; assumption?: string; resolvedQuestion?: string; newOpenQuestion?: string; resolvesDimension?: ExplorationDimension }
  | { type: 'attachPrototype'; htmlPath: string; label: string }
  | { type: 'approvePrototype'; selection: string }
  | { type: 'attachDesignArtifact'; designMd: string; designHtml: string; designVersion: string }
  | { type: 'runDesignReview'; passed: boolean; blockingReasons: string[] }
  | { type: 'approveDesign' }
  | { type: 'attachImplementationTarget'; route: string; needsAuthedSession: boolean }
  | { type: 'attachGapReport'; reportRef: string; blockingCount: number; warningCount: number; autoFixApplied?: boolean }
  | { type: 'recordPatchIntent'; intent: PatchIntentInput }
  | { type: 'markDone'; acceptRemainingWarnings: boolean };

export type FlowActionType = FlowAction['type'];

/** invariant 不满足时抛出，message 必须是能直接展示给用户的人话。 */
export class InvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvariantError';
  }
}

const STAGE_LABEL: Record<FlowStage, string> = {
  proposal: 'Proposal / 原型',
  design: 'Design / 设计',
  code: 'Code / 实现',
  done: '已完成',
};

/** 解析目标项目里某个相对路径是否存在。由 store 注入，actions 本身不碰文件系统。 */
export type FileExists = (relPathFromTargetRoot: string) => boolean;

function requireStage(ledger: FlowLedger, stage: FlowStage, actionLabel: string): void {
  if (ledger.currentStage !== stage) {
    throw new InvariantError(
      `${actionLabel}要求当前在「${STAGE_LABEL[stage]}」阶段，但现在在「${STAGE_LABEL[ledger.currentStage]}」。`,
    );
  }
}

/** action 前的不变量检查。失败抛 InvariantError（人话）。 */
export function assertCanApply(ledger: FlowLedger, action: FlowAction, fileExists: FileExists): void {
  switch (action.type) {
    case 'recordQuestionAnswer':
      requireStage(ledger, 'proposal', '记录探索问答');
      return;

    case 'attachPrototype':
      requireStage(ledger, 'proposal', 'attach 原型');
      if (!fileExists(action.htmlPath)) {
        throw new InvariantError(`找不到原型 HTML：${action.htmlPath}。先生成原型文件再 attach。`);
      }
      return;

    case 'approvePrototype':
      requireStage(ledger, 'proposal', '批准原型方向');
      if (ledger.artifactRefs.prototypeHtml.length === 0) {
        throw new InvariantError('还没有任何已 attach 的原型方向，不能批准选择；先 attachPrototype。');
      }
      return;

    case 'attachDesignArtifact':
      requireStage(ledger, 'design', 'attach 正式设计稿');
      if (!fileExists(action.designMd)) {
        throw new InvariantError(`找不到设计文档：${action.designMd}。`);
      }
      if (!fileExists(action.designHtml)) {
        throw new InvariantError(`找不到 HTML 设计稿：${action.designHtml}。`);
      }
      if (action.designVersion.trim() === '') {
        throw new InvariantError('attach 设计稿必须带 DESIGN.md 版本（designVersion），否则审查门无法对齐设计语言版本。');
      }
      return;

    case 'runDesignReview':
      requireStage(ledger, 'design', '跑设计稿审查门');
      if (!ledger.artifactRefs.designMd || !ledger.artifactRefs.designHtml) {
        throw new InvariantError('还没 attach 设计稿（design md / html），不能跑审查门。');
      }
      if (ledger.designVersion === null) {
        throw new InvariantError('进入设计稿审查门前必须先记录 DESIGN.md 版本（designVersion）。');
      }
      return;

    case 'approveDesign':
      requireStage(ledger, 'design', '批准设计进入 Code');
      if (ledger.reviewStatus.state !== 'passed') {
        const why =
          ledger.reviewStatus.state === 'blocked' && ledger.reviewStatus.blockingReasons.length > 0
            ? `阻塞原因：${ledger.reviewStatus.blockingReasons.join('；')}`
            : '审查门还没跑或未通过。';
        throw new InvariantError(`设计评审还没通过（当前「${ledger.reviewStatus.state}」），不能进入 Code。${why}`);
      }
      return;

    case 'attachImplementationTarget':
      requireStage(ledger, 'code', '设定实现页面目标');
      if (action.route.trim() === '') {
        throw new InvariantError('实现页面目标 route / URL 不能为空。');
      }
      return;

    case 'attachGapReport':
      requireStage(ledger, 'code', '记录 gap report');
      if (ledger.implementationTarget === null) {
        throw new InvariantError('还没设定实现页面目标（route / URL），不能记录 gap report；先 attachImplementationTarget。');
      }
      return;

    case 'recordPatchIntent':
      requireStage(ledger, 'code', '记录 PatchIntent');
      return;

    case 'markDone': {
      requireStage(ledger, 'code', '标记 flow 完成');
      const last = ledger.gapHistory.at(-1);
      if (!last) {
        throw new InvariantError('还没跑过任何 gap 检查，不能标记完成。');
      }
      if (last.blockingCount > 0) {
        throw new InvariantError(`最近一轮 gap 还有 ${last.blockingCount} 个阻塞问题，不能标记完成；先修复并重跑 gap。`);
      }
      if (last.warningCount > 0 && !action.acceptRemainingWarnings) {
        throw new InvariantError(`还有 ${last.warningCount} 个提醒项；标记完成需要显式确认接受（acceptRemainingWarnings）。`);
      }
      return;
    }
  }
}

/** 应用 action 的领域状态变更。纯函数：返回新 ledger，不改 eventLog / resumePointer（由 store 负责）。 */
export function reduce(ledger: FlowLedger, action: FlowAction, now: string): FlowLedger {
  const next = structuredClone(ledger);

  switch (action.type) {
    case 'recordQuestionAnswer': {
      next.exploration.decisions.push(`${action.question} → ${action.answer}`);
      if (action.assumption) next.exploration.assumptions.push(action.assumption);
      if (action.newOpenQuestion) next.exploration.openQuestions.push(action.newOpenQuestion);
      if (action.resolvedQuestion) {
        next.exploration.openQuestions = next.exploration.openQuestions.filter((q) => q !== action.resolvedQuestion);
      }
      if (action.resolvesDimension && !next.exploration.resolvedDimensions.includes(action.resolvesDimension)) {
        next.exploration.resolvedDimensions.push(action.resolvesDimension);
      }
      break;
    }
    case 'attachPrototype': {
      if (!next.artifactRefs.prototypeHtml.includes(action.htmlPath)) {
        next.artifactRefs.prototypeHtml.push(action.htmlPath);
      }
      break;
    }
    case 'approvePrototype': {
      next.exploration.decisions.push(`选定方向：${action.selection}`);
      next.currentStage = 'design';
      next.currentGate = 'design-review';
      break;
    }
    case 'attachDesignArtifact': {
      next.artifactRefs.designMd = action.designMd;
      next.artifactRefs.designHtml = action.designHtml;
      next.designVersion = action.designVersion;
      // 新设计稿必须重新评审。
      next.reviewStatus = { state: 'not-run', blockingReasons: [], ranAt: null };
      break;
    }
    case 'runDesignReview': {
      next.reviewStatus = {
        state: action.passed ? 'passed' : 'blocked',
        blockingReasons: action.passed ? [] : action.blockingReasons,
        ranAt: now,
      };
      break;
    }
    case 'approveDesign': {
      next.currentStage = 'code';
      next.currentGate = 'gap-blocking-check';
      break;
    }
    case 'attachImplementationTarget': {
      next.implementationTarget = { route: action.route, needsAuthedSession: action.needsAuthedSession };
      break;
    }
    case 'attachGapReport': {
      next.gapHistory.push({
        round: next.gapHistory.length,
        reportRef: action.reportRef,
        blockingCount: action.blockingCount,
        warningCount: action.warningCount,
        autoFixApplied: action.autoFixApplied ?? false,
        at: now,
      });
      if (!next.artifactRefs.gapReports.includes(action.reportRef)) {
        next.artifactRefs.gapReports.push(action.reportRef);
      }
      break;
    }
    case 'recordPatchIntent': {
      next.patchIntentHistory.push({
        source: action.intent.source,
        purpose: action.intent.purpose,
        scope: action.intent.scope,
        relatedRule: action.intent.relatedRule ?? null,
        needsReverify: action.intent.needsReverify,
        at: now,
        durationMs: action.intent.durationMs ?? null,
        result: action.intent.result ?? null,
      });
      break;
    }
    case 'markDone': {
      next.currentStage = 'done';
      next.currentGate = null;
      break;
    }
  }

  return next;
}

/** 中断后下一步能做什么（人话 + 允许的 action 集合）。 */
export function computeResumePointer(ledger: FlowLedger): { nextActions: FlowActionType[]; hint: string } {
  switch (ledger.currentStage) {
    case 'proposal':
      if (ledger.artifactRefs.prototypeHtml.length === 0) {
        return { nextActions: ['recordQuestionAnswer', 'attachPrototype'], hint: '继续苏格拉底式探索，或发散 2-3 个 HTML 原型方向。' };
      }
      return {
        nextActions: ['recordQuestionAnswer', 'attachPrototype', 'approvePrototype'],
        hint: '评审原型方向，选择 / 合并后用 approvePrototype 收敛。',
      };

    case 'design':
      if (!ledger.artifactRefs.designMd || !ledger.artifactRefs.designHtml) {
        return { nextActions: ['attachDesignArtifact'], hint: '生成需求级设计文档和正式 HTML 设计稿并 attach。' };
      }
      if (ledger.reviewStatus.state !== 'passed') {
        return {
          nextActions: ['runDesignReview', 'attachDesignArtifact'],
          hint: ledger.reviewStatus.state === 'blocked' ? '审查未过，修订设计稿后重跑 runDesignReview。' : '跑设计稿审查门 runDesignReview。',
        };
      }
      return { nextActions: ['approveDesign'], hint: '审查已过，确认后用 approveDesign 进入 Code。' };

    case 'code': {
      if (ledger.implementationTarget === null) {
        return { nextActions: ['attachImplementationTarget'], hint: '设定实现页面 route / URL（复用已登录会话）。' };
      }
      const last = ledger.gapHistory.at(-1);
      if (!last) {
        return { nextActions: ['attachGapReport'], hint: '对实现页面跑首轮 gap，再 attachGapReport。' };
      }
      if (last.blockingCount > 0) {
        return {
          nextActions: ['attachGapReport', 'recordPatchIntent'],
          hint: `还有 ${last.blockingCount} 个阻塞问题；修复后重跑 gap，或记录 PatchIntent。`,
        };
      }
      return {
        nextActions: ['markDone', 'recordPatchIntent', 'attachGapReport'],
        hint: last.warningCount > 0 ? `阻塞已清，剩 ${last.warningCount} 个提醒；可继续 live 微调，或确认接受后 markDone。` : '阻塞已清，可 markDone。',
      };
    }

    case 'done':
      return { nextActions: [], hint: '已完成：设计产物与实现页面对齐。' };
  }
}

export interface FlowStatusSummary {
  step: string;
  decideNow: string;
  artifacts: string[];
  blockedReason: string | null;
}

const STEP_LABEL: Record<FlowGate | 'done', string> = {
  'prototype-selection': 'Proposal：发散 / 选择原型方向',
  'design-review': 'Design：正式设计稿与审查门',
  'gap-blocking-check': 'Code：gap 验证与自动修复',
  'live-review': 'Code：人工 live 局部修复',
  done: '已完成',
};

/** 用户可读状态摘要（tasks 5.1）：当前步骤 / 现在要决定什么 / 已有产物 / 为什么不能继续。 */
export function statusSummary(ledger: FlowLedger): FlowStatusSummary {
  const step = ledger.currentGate ? STEP_LABEL[ledger.currentGate] : STEP_LABEL.done;

  const artifacts: string[] = [];
  if (ledger.artifactRefs.prototypeHtml.length > 0) artifacts.push(`原型方向 ×${ledger.artifactRefs.prototypeHtml.length}`);
  if (ledger.artifactRefs.designMd) artifacts.push(`设计文档：${ledger.artifactRefs.designMd}`);
  if (ledger.artifactRefs.designHtml) artifacts.push(`HTML 设计稿：${ledger.artifactRefs.designHtml}`);
  const lastGap = ledger.gapHistory.at(-1);
  if (lastGap) artifacts.push(`gap 报告 ×${ledger.gapHistory.length}（最近：阻塞 ${lastGap.blockingCount} / 提醒 ${lastGap.warningCount}）`);
  if (ledger.patchIntentHistory.length > 0) artifacts.push(`PatchIntent ×${ledger.patchIntentHistory.length}`);

  let blockedReason: string | null = null;
  if (ledger.currentStage === 'design' && ledger.reviewStatus.state === 'blocked') {
    blockedReason = `设计评审未过：${ledger.reviewStatus.blockingReasons.join('；') || '见审查报告'}`;
  } else if (ledger.currentStage === 'code' && lastGap && lastGap.blockingCount > 0) {
    blockedReason = `最近一轮 gap 有 ${lastGap.blockingCount} 个阻塞问题`;
  }

  return { step, decideNow: ledger.resumePointer.hint, artifacts, blockedReason };
}

/** eventLog 里一条事件的人话摘要。 */
export function summarizeAction(action: FlowAction): string {
  switch (action.type) {
    case 'recordQuestionAnswer':
      return `探索问答：${action.question}`;
    case 'attachPrototype':
      return `attach 原型方向「${action.label}」：${action.htmlPath}`;
    case 'approvePrototype':
      return `选定方向「${action.selection}」，进入 Design`;
    case 'attachDesignArtifact':
      return `attach 设计稿（DESIGN.md@${action.designVersion}）`;
    case 'runDesignReview':
      return action.passed ? '设计审查门：通过' : `设计审查门：阻塞（${action.blockingReasons.length} 项）`;
    case 'approveDesign':
      return '批准设计，进入 Code';
    case 'attachImplementationTarget':
      return `设定实现目标：${action.route}`;
    case 'attachGapReport':
      return `gap 一轮：阻塞 ${action.blockingCount} / 提醒 ${action.warningCount}`;
    case 'recordPatchIntent':
      return `PatchIntent（${action.intent.source}）：${action.intent.purpose}`;
    case 'markDone':
      return 'flow 完成';
  }
}
