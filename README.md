# AI Design Workflow System (ADW)

**Agent 主控流程 + ADW CLI 确定性底座** 的「设计到代码」工作流套件。它不是一个独立跑完整条流程的产品，而是：

- **B 主流程**：在 Claude Code / Codex 这类 AI harness 里，由 agent 主控需求澄清、HTML 原型、正式设计产物、代码实现、gap 验证和 live 修复（编排入口见 T17，已提供 `skill:install`）。
- **A 底座**：ADW CLI 提供确定性动作——Flow Ledger、artifact 读写、gap 验证、`impeccable detect` adapter、DESIGN.md delta gate、handoff/import——供 agent 安全调用、可复跑、可校验。

三个工作台：Proposal / Prototype → Design → Code，把一句话需求带到可评审设计产物、代码实现、gap 验证和人工 live 修复。

## 最快使用：复制给 Claude Code / Codex

在目标项目里打开 Claude Code 或 Codex，然后把下面整段话复制进去：

```text
请在当前仓库启用 ADW，并用它推进我的设计到代码工作流。

先运行：
npx -y github:dufemeng/ai-design-workflow init --target . --harness both --update

安装完成后使用 adw-workflow。每一步先读 flow 状态，再按 Proposal / Prototype → Design → Code 推进。不要手改 docs/design-<flow>.workflow.json，不要静默修改根 DESIGN.md。

如果当前环境找不到 adw 命令，就用：
npx -y github:dufemeng/ai-design-workflow <command>

来代替所有：
adw <command>

我的需求是：「把这里替换成一句话需求」
flow slug 使用：my-flow
```

这段会把 ADW workflow 安装到当前目标仓库：

- Claude Code：`.claude/skills/adw-workflow/SKILL.md`
- Codex：`AGENTS.md` 中的 ADW 区块

之后 agent 会用 ADW CLI 记录 flow 状态、生成 HTML 原型 / 正式设计稿、运行 gap report，并在需要 Impeccable `/document`、`/critique`、`/live` 时走 handoff/import。

## Impeccable 的两类能力（硬边界，别混淆）

[Impeccable](https://github.com/pbakaus/impeccable) 不重造，但按能否脚本化分两层：

- **Callable tool**：`impeccable detect --json` —— ADW CLI 直接调用、解析、写 report（已接入，结果带 `source: impeccable-detect`）。
- **Agent skill**：`/document` `/critique` `/polish` `/audit` `/live` —— **只能由 agent 执行**，ADW 通过 handoff/import 协议交接产物，绝不由 CLI spawn。

## 仓库关系

- 本仓库 = 产品代码的家。
- 被加工的「目标项目」是另外的仓库（第一个目标是 sibling 的 `sdd-telemetry`）。
- 产物（`design-<flow>.md`、`design-<flow>.workflow.json`、`gap-report` 等）落在**目标项目**的 `docs/` 下，不落在本仓库。

## 规格

权威规格在 `docs/`（实现严格按这两份执行）：

- `docs/design-ai-design-workflow-system.md` — 架构设计（Agent 主控改造版）。
- `docs/tasks-ai-design-workflow-system-mvp.md` — MVP 实施方案（任务 T0–T18、阶段计划、验收清单、action↔CLI 命令契约表 §5.3）。

## 进度

底座模块（Stage 1）：

- [x] T0 配置和 artifact 协议（`src/config`）
- [x] T1 Flow Ledger Store（`src/flow`：状态机 + action/invariant + 续跑）
- [x] T2 模板 registry 接入（`src/templates`：可配置源 + 内置兜底 + 场景推荐）
- [x] T3 项目扫描 + Stage 0 retrospective（`src/scan`）
- [x] T4 Product Context / DESIGN.md 冷启动（`src/design`）
- [x] T5 Proposal 探索循环（`src/proposal`）
- [x] T6 HTML 原型发散 workbench（`src/proposal/prototype`）
- [x] T7 需求级正式设计产物（`src/design-flow`：机器可读 spec + 准入门）
- [x] T8 设计稿审查门（`src/review`：确定性层 + 判断层证据契约）
- [x] T9 Code 工作台接入（`src/code`）
- [x] T10 gap engine —— 实现页健康 + token/detect 闸门（`src/gap`）
- [x] T11 自动修复 loop（`src/autofix`：安全契约 + 收敛/回滚）
- [x] T12 Human Live Review（`src/live`：gap 门控 workbench + PatchIntent；真实改页走 agent `/live`）
- [x] T13 DESIGN.md 更新门禁（`src/design/delta`：delta proposal + 显式 confirm）

Stage 1.5 P0 清债：

- [x] T16 Flow 生命周期命令闭环（`flow:create` / `proposal:answer` / `design:approve` / `flow:done`，闭环现可经 CLI 端到端跑通）
- [x] T14a Impeccable Detect Adapter + 删除自写 detector 主路径（`src/impeccable`）
- [x] T14b Skill Handoff / Import 协议（`handoff:<skill>` / `import:<skill>`，`document` / `critique` 专用 schema + 其他 skill 通用 provenance 骨架）
- [x] T17 ADW Agent 编排入口（可安装 skill：`skill:install`，Claude Code skill + AGENTS.md 兼容）
- [x] T15 State / Interaction Driver（`ScreenStateSchema.driver` + runtime driver + `not-testable` report）

Stage 2：

- [x] T18 设计稿 baseline gap diff（以 `design-<flow>.html` 为 baseline 做语义/DOM diff；视觉 diff 仍只作为后续证据增强）

## 开发

```bash
pnpm install
pnpm typecheck
pnpm test                               # build + 跑全部 scripts/verify-*.mjs 行为测试
pnpm adw config:check <目标项目目录>     # 校验目标项目配置，没有配置则用默认值
```

flow 生命周期（agent 按 §5.3 契约表调用，全程不手改 `workflow.json`）：

```bash
pnpm adw flow:create <dir> <slug> <title>
pnpm adw proposal:answer <dir> <slug> <q> <a>      # 探索问答落账
# … proposal:generate / proposal:approve / design:flow-generate / design:review
pnpm adw design:approve <dir> <slug>               # 审查门过后进入 Code
pnpm adw code:target / gap:run / live:record
pnpm adw flow:done <dir> <slug> [--accept-warnings]
pnpm adw flow:status <dir> <slug>                  # 任意时刻看「在哪步/要决定什么/为什么卡住」
pnpm adw skill:install <dir> --harness both         # 安装 ADW agent 编排入口
```
