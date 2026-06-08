// T18 可证伪验证：gap:run 必须加载 docs/design-<flow>.html 做 baseline 语义 diff。
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG } from '../dist/config/index.js';
import { DesignFlowSpecSchema, writeDesignFlow } from '../dist/design-flow/index.js';
import { FlowLedgerStore } from '../dist/flow/index.js';
import { runGapLoop } from '../dist/gap/index.js';

const target = mkdtempSync(join(tmpdir(), 'adw-baseline-'));
process.env.ADW_IMPECCABLE_BIN = join(target, 'impeccable-stub.mjs');
writeFileSync(process.env.ADW_IMPECCABLE_BIN, '#!/usr/bin/env node\nprocess.stdout.write("[]");\n');
chmodSync(process.env.ADW_IMPECCABLE_BIN, 0o755);

const slug = 'checkout';
const store = new FlowLedgerStore(target, DEFAULT_CONFIG.artifactDir);
store.create({ slug, title: '结账 baseline' });
writeFileSync(join(target, 'proposal.html'), '<!doctype html><title>P</title><h1>P</h1>');
store.apply(slug, { type: 'attachPrototype', htmlPath: 'proposal.html', label: 'A' });
store.apply(slug, { type: 'approvePrototype', selection: 'A' });

const spec = DesignFlowSpecSchema.parse({
  flow: slug,
  title: '结账',
  designVersion: 'sha256:baseline',
  screens: [
    {
      id: 'home',
      name: '首页',
      mockHtml: '<!doctype html><html lang="zh"><head><title>设计稿</title></head><body><h1>Checkout</h1><p>Total due</p><button>Pay now</button></body></html>',
    },
  ],
  states: [
    { id: 'success', screenId: 'home', kind: 'success', driver: { type: 'query-param', params: { state: 'success' } }, expected: { urlIncludes: 'state=success' } },
  ],
  targetRoute: '/checkout',
  acceptanceRules: [{ id: 'a1', rule: '能看到支付按钮', screenId: 'home' }],
});
const { mdRel, htmlRel } = writeDesignFlow(target, DEFAULT_CONFIG, spec);
store.apply(slug, { type: 'attachDesignArtifact', designMd: mdRel, designHtml: htmlRel, designVersion: 'sha256:baseline' });
store.apply(slug, { type: 'runDesignReview', passed: true, blockingReasons: [] });
store.apply(slug, { type: 'approveDesign' });

const missingPage = join(target, 'missing.html');
writeFileSync(missingPage, '<!doctype html><html lang="zh"><head><title>实现</title></head><body><h1>Checkout</h1><p>Total due</p></body></html>');
store.apply(slug, { type: 'attachImplementationTarget', route: `file://${missingPage}`, needsAuthedSession: false });

const missing = await runGapLoop(target, DEFAULT_CONFIG, slug, { url: `file://${missingPage}` });
const missingBaseline = missing.report.checks.find((c) => c.source?.startsWith('design-baseline:'));
assert.equal(missingBaseline?.status, 'block');
assert.ok(missingBaseline?.findings.join('\n').includes('Pay now'), 'baseline diff 应指出缺少设计稿关键文本');

const fixedPage = join(target, 'fixed.html');
writeFileSync(fixedPage, '<!doctype html><html lang="zh"><head><title>实现</title></head><body><h1>Checkout</h1><p>Total due</p><button>Pay now</button></body></html>');
const fixed = await runGapLoop(target, DEFAULT_CONFIG, slug, { url: `file://${fixedPage}` });
const fixedBaseline = fixed.report.checks.find((c) => c.source?.startsWith('design-baseline:'));
assert.equal(fixedBaseline?.status, 'pass');

console.log('BASELINE DIFF T18 VERIFY: ALL PASS  design-html baseline blocks missing text and passes when fixed');
