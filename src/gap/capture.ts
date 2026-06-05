import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Viewport } from '../config/schema.js';
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
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      storageState: opts.storageStatePath ? opts.storageStatePath : undefined,
    });
    const page = await context.newPage();
    try {
      // 不用 networkidle：SPA 的轮询/websocket 会让它永不静默而超时。load + 短暂 settle 更稳。
      await page.goto(url, { waitUntil: 'load', timeout: 30000 });
      await page.waitForTimeout(1200);
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
      return { url, viewport, domHtml, usedColors, title, screenshotPath };
    } catch (err) {
      // 打不开 / 超时 / 登录重定向 / 提取失败 —— 统一成 GapCaptureError，让 engine 写 failed 报告而不是崩。
      throw new GapCaptureError(`采集实现页面失败：${String((err as Error).message).split('\n')[0]}`, '确认本地页面已启动、URL 正确、已登录会话（storageState）有效；SPA 渲染慢可调大等待。');
    }
  } finally {
    await browser.close();
  }
}
