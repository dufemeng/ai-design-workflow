import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, join } from 'node:path';
import type { Viewport } from '../config/schema.js';
import type { InteractionDriver, InteractionStep, StateDriver } from '../design-flow/index.js';
import type { PageSnapshot } from './snapshot.js';

export class GapCaptureError extends Error {
  constructor(
    message: string,
    readonly hint: string,
  ) {
    super(message);
    this.name = 'GapCaptureError';
  }
}

export interface CaptureOptions {
  /** 复用已登录会话的 storageState 文件（gap loop 不负责登录本身）。 */
  storageStatePath?: string;
  screenshotPath?: string;
  driverBaseDir?: string;
  stateDriver?: StateDriver;
  interactionDriver?: InteractionDriver;
}

function scalar(v: string | number | boolean): string {
  return String(v);
}

function addQueryParams(rawUrl: string, params: Record<string, string | number | boolean>): string {
  const u = new URL(rawUrl);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, scalar(v));
  return u.toString();
}

function contentTypeFor(path: string): string {
  const ext = extname(path).toLowerCase();
  if (ext === '.json') return 'application/json';
  if (ext === '.html' || ext === '.htm') return 'text/html';
  return 'text/plain';
}

function fixturePath(baseDir: string | undefined, relOrAbs: string): string {
  return isAbsolute(relOrAbs) ? relOrAbs : join(baseDir ?? process.cwd(), relOrAbs);
}

function stateDriverUrl(url: string, driver: StateDriver): string {
  if (driver.type === 'query-param') return addQueryParams(url, driver.params);
  if (driver.type === 'feature-flag' && driver.mode === 'query-param') return addQueryParams(url, driver.flags);
  if (driver.type === 'fixture' && driver.mode === 'query-param') return addQueryParams(url, { [driver.paramName]: driver.path });
  return url;
}

async function installStateDriver(
  context: import('playwright').BrowserContext,
  page: import('playwright').Page,
  driver: StateDriver | undefined,
  baseDir: string | undefined,
): Promise<void> {
  if (!driver) return;
  if (driver.type === 'feature-flag' && driver.mode === 'local-storage') {
    await context.addInitScript((flags: Record<string, string | number | boolean>) => {
      const g = globalThis as unknown as { localStorage?: { setItem(k: string, v: string): void } };
      g.localStorage?.setItem('__ADW_FEATURE_FLAGS__', JSON.stringify(flags));
      for (const [k, v] of Object.entries(flags)) g.localStorage?.setItem(`adw:flag:${k}`, String(v));
    }, driver.flags);
  }
  if (driver.type === 'mock-response') {
    await page.route(driver.urlPattern, async (route) => {
      const body = typeof driver.body === 'string' ? driver.body : JSON.stringify(driver.body ?? {});
      await route.fulfill({ status: driver.status, headers: driver.headers, body });
    });
  }
  if (driver.type === 'fixture' && driver.mode === 'mock-response') {
    if (!driver.urlPattern) throw new GapCaptureError(`fixture driver 缺少 urlPattern：${driver.path}`, 'mode=mock-response 时需要声明 urlPattern。');
    const path = fixturePath(baseDir, driver.path);
    if (!existsSync(path)) throw new GapCaptureError(`fixture 文件不存在：${driver.path}`, '检查 fixture path，建议使用相对目标项目根目录的路径。');
    const body = readFileSync(path, 'utf8');
    await page.route(driver.urlPattern, async (route) => {
      await route.fulfill({ status: driver.status, contentType: contentTypeFor(path), body });
    });
  }
}

async function runStatePostHook(page: import('playwright').Page, driver: StateDriver | undefined): Promise<void> {
  if (!driver) return;
  if (driver.type === 'test-hook') {
    await page.evaluate(
      ({ hook, params }) => {
        const g = globalThis as unknown as {
          __ADW_STATE_DRIVERS__?: Record<string, (params: unknown) => unknown | Promise<unknown>>;
        } & Record<string, unknown>;
        const fn = g.__ADW_STATE_DRIVERS__?.[hook] ?? g[hook];
        if (typeof fn !== 'function') throw new Error(`test-hook 不存在：${hook}`);
        return (fn as (params: unknown) => unknown | Promise<unknown>)(params);
      },
      { hook: driver.hook, params: driver.params },
    );
    await page.waitForTimeout(400);
  }
  if (driver.type === 'seed-data') {
    throw new GapCaptureError(`seed-data driver 需要外部准备：${driver.description}`, '把状态改成 query-param / mock-response / fixture / test-hook，或补 notTestableReason。');
  }
}

async function runInteractionStep(page: import('playwright').Page, step: InteractionStep): Promise<void> {
  if (step.action === 'click' || step.action === 'expand-collapse') {
    await page.locator(step.selector).first().click({ timeout: 5000 });
    return;
  }
  if (step.action === 'input') {
    await page.locator(step.selector).first().fill(step.value, { timeout: 5000 });
    return;
  }
  if (step.action === 'scroll') {
    if (step.selector) {
      await page.locator(step.selector).first().evaluate((el, pos) => {
        (el as unknown as { scrollBy(x: number, y: number): void }).scrollBy(pos.x, pos.y);
      }, { x: step.x, y: step.y });
    } else {
      await page.evaluate((pos) => {
        (globalThis as unknown as { scrollBy(x: number, y: number): void }).scrollBy(pos.x, pos.y);
      }, { x: step.x, y: step.y });
    }
    return;
  }
  await page.keyboard.press(step.key);
}

async function runInteractionDriver(page: import('playwright').Page, driver: InteractionDriver | undefined): Promise<void> {
  if (!driver) return;
  for (const step of driver.steps) {
    await runInteractionStep(page, step);
    await page.waitForTimeout(250);
  }
}

/**
 * 用 Playwright 采集实现页面快照。playwright 动态 import，缺浏览器时抛
 * GapCaptureError（engine 据此优雅降级，不伪造通过）。
 */
export async function capturePage(url: string, viewport: Viewport, opts: CaptureOptions = {}): Promise<PageSnapshot> {
  let chromium: typeof import('playwright').chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new GapCaptureError('未安装 playwright。', '在产品仓库 pnpm add playwright。');
  }

  let browser: import('playwright').Browser;
  try {
    browser = await chromium.launch();
  } catch (err) {
    throw new GapCaptureError(`无法启动浏览器：${(err as Error).message}`, '跑 pnpm exec playwright install chromium 安装浏览器二进制。');
  }

  try {
    if (opts.storageStatePath && !existsSync(opts.storageStatePath)) {
      throw new GapCaptureError(`storageState 文件不存在：${opts.storageStatePath}`, '检查 storageState 路径，或先用已登录浏览器导出会话。');
    }
    let pageUrl = url;
    try {
      if (opts.stateDriver) pageUrl = stateDriverUrl(url, opts.stateDriver);
    } catch (err) {
      throw new GapCaptureError(`状态 driver 无法生成 URL：${(err as Error).message}`, 'query-param / feature-flag driver 需要绝对 URL。');
    }
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      storageState: opts.storageStatePath ? opts.storageStatePath : undefined,
    });
    const page = await context.newPage();
    try {
      await installStateDriver(context, page, opts.stateDriver, opts.driverBaseDir);
      // 不用 networkidle：SPA 的轮询/websocket 会让它永不静默而超时。load + 短暂 settle 更稳。
      await page.goto(pageUrl, { waitUntil: 'load', timeout: 30000 });
      await page.waitForTimeout(1200);
      await runStatePostHook(page, opts.stateDriver);
      await runInteractionDriver(page, opts.interactionDriver);
      const domHtml = await page.content();
      const title = await page.title();
      const usedColors: string[] = await page.evaluate(() => {
        // 在浏览器上下文里执行；用 globalThis 取 DOM 全局，避免给 node CLI 引入 dom lib。
        const g = globalThis as unknown as {
          document: { querySelectorAll(s: string): ArrayLike<unknown> };
          getComputedStyle(el: unknown): { color: string; backgroundColor: string };
        };
        const set = new Set<string>();
        const els = Array.from(g.document.querySelectorAll('*')).slice(0, 4000);
        for (const el of els) {
          const cs = g.getComputedStyle(el);
          set.add(cs.color);
          set.add(cs.backgroundColor);
        }
        return Array.from(set);
      });
      // 截图是佐证，不是阻塞标准；失败不影响 gap 判定。
      let screenshotPath: string | null = null;
      if (opts.screenshotPath) {
        try {
          mkdirSync(dirname(opts.screenshotPath), { recursive: true });
          await page.screenshot({ path: opts.screenshotPath, fullPage: true });
          screenshotPath = opts.screenshotPath;
        } catch {
          screenshotPath = null;
        }
      }
      return { url: page.url(), viewport, domHtml, usedColors, title, screenshotPath };
    } catch (err) {
      // 打不开 / 超时 / 登录重定向 / 提取失败 —— 统一成 GapCaptureError，让 engine 写 failed 报告而不是崩。
      throw new GapCaptureError(`采集实现页面失败：${String((err as Error).message).split('\n')[0]}`, '确认本地页面已启动、URL 正确、已登录会话（storageState）有效；SPA 渲染慢可调大等待。');
    }
  } finally {
    await browser.close();
  }
}
