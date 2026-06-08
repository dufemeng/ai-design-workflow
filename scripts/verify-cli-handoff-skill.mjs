// T14b/T17 CLI 可达性验证：不用直接调模块，跑真实 dist/cli.js。
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = join(process.cwd(), 'dist', 'cli.js');
assert.ok(existsSync(CLI), 'dist/cli.js 不存在，先 npm run build');

const target = mkdtempSync(join(tmpdir(), 'adw-cli-handoff-'));
const run = (...args) => execFileSync('node', [CLI, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

run('flow:create', target, 'docflow', 'Document Handoff');
const handoffOut = run('handoff:document', target, 'docflow');
assert.ok(handoffOut.includes('handoff context'), handoffOut);

const design = `---
name: ADW
description: Imported
colors:
  brand: "#faff69"
typography:
  display:
    fontFamily: "Inter"
---

# Design System

## 1. Overview
Overview.

## 2. Colors
Colors.

## 3. Typography
Typography.

## 4. Elevation
Elevation.

## 5. Components
Components.

## 6. Do's and Don'ts
Rules.
`;

const resultPath = join(target, 'document-result.json');
writeFileSync(resultPath, JSON.stringify({
  source: 'agent-skill',
  skill: 'document',
  agentHarness: 'codex',
  inputRefs: [],
  outputRefs: [],
  designVersion: null,
  confirmedBy: 'user',
  designMdContent: design,
  sidecar: null,
  tokensSummary: { colors: { brand: '#faff69' }, typography: {} },
}, null, 2));
const importOut = run('import:document', target, 'docflow', resultPath);
assert.ok(importOut.includes('DESIGN.md.draft'), importOut);
assert.ok(existsSync(join(target, 'DESIGN.md.draft')));
assert.equal(existsSync(join(target, 'DESIGN.md')), false, 'import:document 不能直接写根 DESIGN.md');

const installOut = run('skill:install', target, '--harness', 'both');
assert.ok(installOut.includes('adw-workflow'), installOut);
assert.ok(existsSync(join(target, '.claude', 'skills', 'adw-workflow', 'SKILL.md')));
assert.ok(readFileSync(join(target, '.claude', 'skills', 'adw-workflow', 'SKILL.md'), 'utf8').includes('npx -y github:dufemeng/ai-design-workflow'));
assert.ok(readFileSync(join(target, 'AGENTS.md'), 'utf8').includes('BEGIN ADW WORKFLOW SKILL'));

const initOut = run('init', '--target', target, '--harness', 'both', '--update');
assert.ok(initOut.includes('ADW 已启用'), initOut);
assert.ok(initOut.includes('npx -y github:dufemeng/ai-design-workflow <command>'), initOut);

console.log('CLI HANDOFF/SKILL VERIFY: ALL PASS  handoff:document + import:document + skill:install + init');
