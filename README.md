# AI Design Workflow System

可安装、跨项目的「设计到代码」工作流编排器。它不是某个项目的内置功能，而是一个**对目标仓库运行**的产品：用三个工作台（Proposal / Prototype、Design、Code）把一句话需求带到可评审的设计产物、代码实现、gap 验证和 live 修复。

底座复用 [Impeccable](https://github.com/pbakaus/impeccable)（设计质量、detector、live、polish），本系统在其上增加需求级编排、HTML 方案选择、设计产物管理和 gap 验证闭环。

## 仓库关系

- 本仓库 = 产品代码的家。
- 被加工的「目标项目」是另外的仓库（第一个目标是 sibling 的 `sdd-telemetry`）。
- 产物（`design-<flow>.md`、`workflow.json`、`gap-report` 等）落在**目标项目**的 `docs/` 下，不落在本仓库。

## 规格

权威规格在 `docs/`：

- `docs/design-ai-design-workflow-system.md` — 架构设计。
- `docs/tasks-ai-design-workflow-system-mvp.md` — MVP 实施方案（任务 T0–T13、四阶段计划、验收清单）。

实现严格按这两份文档执行。

## 进度

- [x] T0 配置和 artifact 协议（`src/config`）
- [x] T1 Flow Ledger Store（`src/flow`：状态机 + action/invariant + 续跑）
- [x] T2 模板 registry 接入（`src/templates` + 内置 `templates/`：可配置源 + 内置兜底 + 场景推荐）
- [x] T3 项目扫描 + Stage 0 retrospective（`src/scan`：snapshot + 缺口启发式检查）
- [x] T4 Product Context / DESIGN.md 冷启动（`src/design`：解析/版本/确认页/写策略）
- [x] T5 Proposal 探索循环（`src/proposal`：维度收敛骨架）
- [ ] T6 HTML 原型发散 workbench
- [ ] T7–T13

## 开发

```bash
pnpm install
pnpm typecheck
pnpm adw config:check <目标项目目录>   # 校验目标项目的配置，没有配置则用默认值
```
