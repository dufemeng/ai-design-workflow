// T2 可证伪验证：内置兜底 / 推荐映射 / 「必须选模板或声明 fallback」/ 可配置源覆盖。
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRegistry, RegistryError } from '../dist/templates/index.js';

const target = mkdtempSync(join(tmpdir(), 'adw-tpl-'));

// 1) 默认 config 指向 html-anything（无 adw-registry.json）→ 回退内置，带提示
const def = loadRegistry({ type: 'package', value: 'html-anything' }, target);
assert.equal(def.source, 'builtin', '应回退到内置');
assert.ok(def.notes.length > 0, '回退应给提示');
assert.equal(def.registry.list().length, 8, '内置应有 8 个模板');

const reg = def.registry;

// 2) 推荐映射（含跨用 mobile-app）
assert.deepEqual(reg.recommend('h5-single').map((t) => t.id), ['mobile-app']);
assert.deepEqual(reg.recommend('h5-flow').map((t) => t.id), ['mobile-onboarding', 'mobile-app']);
assert.deepEqual(reg.recommend('eng-handoff').map((t) => t.id), ['eng-runbook', 'docs-page']);
assert.deepEqual(reg.recommend('data-report').map((t) => t.id), ['data-report', 'dashboard']);

// 3) selectTemplate 硬约束
const byScenario = reg.selectTemplate({ scenario: 'h5-single' });
assert.equal(byScenario.kind, 'template');
assert.equal(byScenario.id, 'mobile-app');
assert.ok(existsSync(byScenario.shellPath), 'shell 必须能当静态文件打开');

// override 覆盖推荐
const byOverride = reg.selectTemplate({ scenario: 'h5-single', overrideId: 'pm-spec' });
assert.equal(byOverride.kind, 'template');
assert.equal(byOverride.id, 'pm-spec', 'override 应覆盖 scenario');

// 既没 scenario 也没 override 也没 fallback → 必须报错
assert.throws(() => reg.selectTemplate({}), RegistryError, '无选择必须报错');

// 只给 fallbackShell → 允许
const byFallback = reg.selectTemplate({ fallbackShell: 'custom-shell.html' });
assert.equal(byFallback.kind, 'fallback');

// 不存在的 override id → 报错
assert.throws(() => reg.selectTemplate({ overrideId: 'no-such' }), RegistryError);

// 4) 所有内置模板 shell 都存在
for (const t of reg.list()) {
  assert.ok(existsSync(reg.shellAbsPath(t.id)), `shell 缺失：${t.id}`);
}

// 5) 可配置源覆盖：临时 path registry 带合法 manifest → source=configured
const extRoot = mkdtempSync(join(tmpdir(), 'adw-extreg-'));
mkdirSync(join(extRoot, 'shells'), { recursive: true });
writeFileSync(join(extRoot, 'shells', 'x.html'), '<!doctype html><title>x</title>');
writeFileSync(
  join(extRoot, 'adw-registry.json'),
  JSON.stringify({ templates: [{ id: 'x', name: 'X', scenario: 'web-proto', surface: 'web', description: '外部模板', shellPath: 'shells/x.html' }] }),
);
const ext = loadRegistry({ type: 'path', value: extRoot }, target);
assert.equal(ext.source, 'configured', '合法 path 源应被采用');
assert.deepEqual(ext.registry.list().map((t) => t.id), ['x']);

console.log('TEMPLATES T2 VERIFY: ALL PASS  builtin=8 configured-override=ok');
