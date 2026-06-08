// T14b 可证伪验证：handoff context、/document import draft、/critique import + review gate provenance。
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG } from '../dist/config/index.js';
import { validateDesignMdForImport } from '../dist/design/index.js';
import { DesignFlowSpecSchema, writeDesignFlow } from '../dist/design-flow/index.js';
import { FlowLedgerStore } from '../dist/flow/index.js';
import { createSkillHandoff, HandoffError, importSkillResult } from '../dist/handoff/index.js';

const target = mkdtempSync(join(tmpdir(), 'adw-handoff-'));
mkdirSync(join(target, 'docs'), { recursive: true });

const stub = join(target, 'impeccable-stub.mjs');
writeFileSync(stub, '#!/usr/bin/env node\nprocess.stdout.write("[]");\n');
chmodSync(stub, 0o755);
process.env.ADW_IMPECCABLE_BIN = stub;

const validDesign = `---
name: ADW
description: Agentic design workflow
colors:
  brand: "#faff69"
typography:
  display:
    fontFamily: "Inter"
---

# Design System

## 1. Overview
Clear product identity.

## 2. Colors
Brand and neutral colors.

## 3. Typography
Type scale and weights.

## 4. Elevation
Layering and shadows.

## 5. Components
Buttons, cards, forms.

## 6. Do's and Don'ts
Do keep H5 usable.
`;

assert.equal(validateDesignMdForImport(validDesign).valid, true);
assert.equal(validateDesignMdForImport('# Missing').valid, false);

writeFileSync(join(target, 'DESIGN.md'), validDesign);
writeFileSync(join(target, 'docs', 'proposal-checkout.html'), '<!doctype html><title>P</title><h1>P</h1>');

const store = new FlowLedgerStore(target, 'docs');
store.create({ slug: 'checkout', title: '结账' });
store.apply('checkout', { type: 'attachPrototype', htmlPath: 'docs/proposal-checkout.html', label: '方向A' });
store.apply('checkout', { type: 'approvePrototype', selection: '方向A' });

const spec = DesignFlowSpecSchema.parse({
  flow: 'checkout',
  title: '结账',
  designVersion: 'sha256:test',
  screens: [{ id: 'home', name: '首页' }],
  states: [
    { id: 'empty', screenId: 'home', kind: 'empty' },
    { id: 'loading', screenId: 'home', kind: 'loading' },
    { id: 'error', screenId: 'home', kind: 'error' },
  ],
  targetRoute: '/checkout',
  acceptanceRules: [{ id: 'a1', rule: '有错误态' }],
});
const { mdRel, htmlRel } = writeDesignFlow(target, DEFAULT_CONFIG, spec);
store.apply('checkout', { type: 'attachDesignArtifact', designMd: mdRel, designHtml: htmlRel, designVersion: 'sha256:test' });

const handoff = createSkillHandoff(target, DEFAULT_CONFIG, 'checkout', 'critique');
assert.ok(existsSync(handoff.contextPath), 'handoff context 应落盘');
assert.equal(handoff.context.skill, 'critique');
assert.equal(handoff.context.designVersion, 'sha256:test');

const docResult = join(target, 'document-result.json');
writeFileSync(docResult, JSON.stringify({
  source: 'agent-skill',
  skill: 'document',
  agentHarness: 'codex',
  inputRefs: [handoff.contextRel],
  outputRefs: [],
  designVersion: 'sha256:test',
  confirmedBy: 'user',
  designMdContent: validDesign.replace('Agentic design workflow', 'Imported design workflow'),
  sidecar: { components: [] },
  tokensSummary: { colors: { brand: '#faff69' }, typography: {} },
}, null, 2));
const docImport = importSkillResult(target, DEFAULT_CONFIG, 'checkout', docResult);
assert.equal(docImport.skill, 'document');
assert.ok(existsSync(join(target, 'DESIGN.md.draft')), 'document import 应写 DESIGN.md.draft');
assert.ok(existsSync(join(target, 'docs', 'design-system-confirmation.html')), 'document import 应写确认页');
assert.ok(readFileSync(join(target, 'DESIGN.md'), 'utf8').includes('Agentic design workflow'), 'document import 不应直接覆盖根 DESIGN.md');

const badDoc = join(target, 'bad-document-result.json');
writeFileSync(badDoc, JSON.stringify({
  source: 'agent-skill',
  skill: 'document',
  agentHarness: 'codex',
  inputRefs: [],
  outputRefs: [],
  designVersion: 'sha256:test',
  confirmedBy: 'user',
  designMdContent: '# bad',
  sidecar: null,
  tokensSummary: {},
}, null, 2));
assert.throws(() => importSkillResult(target, DEFAULT_CONFIG, 'checkout', badDoc), HandoffError);

const critiqueResult = join(target, 'critique-result.json');
writeFileSync(critiqueResult, JSON.stringify({
  source: 'agent-skill',
  skill: 'critique',
  agentHarness: 'codex',
  inputRefs: [handoff.contextRel],
  outputRefs: [],
  designVersion: 'sha256:test',
  confirmedBy: 'user',
  findings: [{ dimension: 'ia', severity: 'fatal', message: '主路径证据不足', evidence: { screen: 'home' } }],
}, null, 2));
const critiqueImport = importSkillResult(target, DEFAULT_CONFIG, 'checkout', critiqueResult);
assert.equal(critiqueImport.skill, 'critique');
const report = JSON.parse(readFileSync(join(target, 'docs', 'assets', 'checkout', 'design-review.json'), 'utf8'));
assert.equal(report.importedCritique.skill, 'critique');
assert.equal(new FlowLedgerStore(target, 'docs').read('checkout').reviewStatus.state, 'blocked');

console.log('HANDOFF T14b VERIFY: ALL PASS  handoff + document/critique import');
