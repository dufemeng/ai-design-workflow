// T17 可证伪验证：skill:install 底层安装器可安装 Claude Code skill 和 Codex AGENTS 片段，重复执行不重复追加。
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installAdwSkill } from '../dist/skill/index.js';

const target = mkdtempSync(join(tmpdir(), 'adw-skill-'));

const first = installAdwSkill(target, { harness: 'both', update: false });
assert.ok(first.installed.includes(join('.claude', 'skills', 'adw-workflow', 'SKILL.md')));
assert.ok(first.installed.includes('AGENTS.md#adw-workflow'));
assert.ok(existsSync(join(target, '.claude', 'skills', 'adw-workflow', 'SKILL.md')));
assert.ok(existsSync(join(target, 'AGENTS.md')));

const agents1 = readFileSync(join(target, 'AGENTS.md'), 'utf8');
assert.equal((agents1.match(/BEGIN ADW WORKFLOW SKILL/g) ?? []).length, 1);
assert.ok(agents1.includes('adw flow:create'));

const second = installAdwSkill(target, { harness: 'both', update: false });
assert.equal(second.installed.length, 0);
assert.equal(second.skipped.length, 2);
const agents2 = readFileSync(join(target, 'AGENTS.md'), 'utf8');
assert.equal((agents2.match(/BEGIN ADW WORKFLOW SKILL/g) ?? []).length, 1, '重复安装不应重复追加 AGENTS 区块');

const update = installAdwSkill(target, { harness: 'codex', update: true });
assert.deepEqual(update.installed, ['AGENTS.md#adw-workflow']);
const agents3 = readFileSync(join(target, 'AGENTS.md'), 'utf8');
assert.equal((agents3.match(/BEGIN ADW WORKFLOW SKILL/g) ?? []).length, 1, 'update 应替换而不是追加');

console.log('SKILL-INSTALL T17 VERIFY: ALL PASS  install + idempotent update');
