import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { z } from 'zod';
import {
  assertCanApply,
  computeResumePointer,
  type FlowAction,
  type FlowStatusSummary,
  reduce,
  statusSummary,
  summarizeAction,
} from './actions.js';
import { type FlowLedger, FlowLedgerSchema } from './schema.js';

export class LedgerError extends Error {
  constructor(
    message: string,
    readonly hint: string,
  ) {
    super(message);
    this.name = 'LedgerError';
  }
}

/**
 * Flow Ledger Store：读写「目标项目」里的 design-<flow>.workflow.json。
 * 每个 action 都是 load → invariant → reduce → 追加 eventLog → 写盘，
 * 所以状态始终在盘上，崩溃 / 中断后 read 回来即可从 resumePointer 续跑。
 */
export class FlowLedgerStore {
  constructor(
    private readonly targetProjectDir: string,
    private readonly artifactDir = 'docs',
  ) {}

  ledgerPath(slug: string): string {
    return join(this.targetProjectDir, this.artifactDir, `design-${slug}.workflow.json`);
  }

  exists(slug: string): boolean {
    return existsSync(this.ledgerPath(slug));
  }

  /** 新建 flow。slug 已存在则拒绝，保证「第二条 flow 不覆盖第一条」。 */
  create(input: { slug: string; title: string }): FlowLedger {
    if (this.exists(input.slug)) {
      throw new LedgerError(
        `flow「${input.slug}」已存在：${this.ledgerPath(input.slug)}`,
        '换一个 slug，或对已有 flow 用 apply 续跑，别覆盖它。',
      );
    }
    const now = new Date().toISOString();
    const ledger: FlowLedger = {
      schemaVersion: 1,
      flowId: input.slug,
      slug: input.slug,
      title: input.title,
      createdAt: now,
      updatedAt: now,
      currentStage: 'proposal',
      currentGate: 'prototype-selection',
      designVersion: null,
      exploration: { assumptions: [], decisions: [], openQuestions: [] },
      artifactRefs: { prototypeHtml: [], designMd: null, designHtml: null, gapReports: [], patches: [] },
      reviewStatus: { state: 'not-run', blockingReasons: [], ranAt: null },
      gapHistory: [],
      patchIntentHistory: [],
      implementationTarget: null,
      resumePointer: { nextActions: [], hint: '' },
      eventLog: [{ seq: 0, action: 'createFlow', at: now, summary: `创建 flow「${input.title}」` }],
    };
    ledger.resumePointer = computeResumePointer(ledger);
    this.persist(ledger);
    return ledger;
  }

  read(slug: string): FlowLedger {
    const path = this.ledgerPath(slug);
    if (!existsSync(path)) {
      throw new LedgerError(`找不到 flow「${slug}」：${path}`, '先用 create 新建，或确认 slug 拼写。');
    }
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, 'utf8'));
    } catch (err) {
      throw new LedgerError(
        `${path} 不是合法 JSON：${(err as Error).message}`,
        'workflow.json 是内部控制面，不要手改；如已损坏，从版本控制恢复。',
      );
    }
    const parsed = FlowLedgerSchema.safeParse(raw);
    if (!parsed.success) {
      throw new LedgerError(`${path} 结构非法：\n${formatIssues(parsed.error)}`, 'workflow.json 是内部控制面，不要手编。');
    }
    return parsed.data;
  }

  /** 应用一个 action：invariant 不过会抛 InvariantError（人话），不会写坏状态。 */
  apply(slug: string, action: FlowAction): FlowLedger {
    const ledger = this.read(slug);
    assertCanApply(ledger, action, (rel) => existsSync(join(this.targetProjectDir, rel)));

    const now = new Date().toISOString();
    const next = reduce(ledger, action, now);
    next.eventLog.push({ seq: ledger.eventLog.length, action: action.type, at: now, summary: summarizeAction(action) });
    next.resumePointer = computeResumePointer(next);
    next.updatedAt = now;
    this.persist(next);
    return next;
  }

  status(slug: string): FlowStatusSummary {
    return statusSummary(this.read(slug));
  }

  private persist(ledger: FlowLedger): void {
    const path = this.ledgerPath(ledger.slug);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
  }
}

function formatIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`).join('\n');
}
