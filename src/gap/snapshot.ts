import type { Viewport } from '../config/schema.js';

/** 浏览器对实现页面采集到的快照。analyze 层只吃这个，不碰浏览器，便于测试。 */
export interface PageSnapshot {
  url: string;
  viewport: Viewport;
  /** 渲染后的 DOM。 */
  domHtml: string;
  /** 页面上实际生效的颜色（computed color / background-color）。 */
  usedColors: string[];
  title: string;
  screenshotPath: string | null;
}
