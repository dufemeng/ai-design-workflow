# AI Design Workflow System MVP 实施方案

更新时间：2026-06-07  
状态：P0 清债重构版；目标为 Agent 主控 + ADW 确定性底座（新增 T16 闭环命令 / T17 agent 入口 / T18 baseline diff）  
关联设计：`docs/design-ai-design-workflow-system.md`

## 1. 实施结论

MVP 不先做完整网页平台，也不把 ADW CLI 当作完整产品主入口。第一版交付形态是：

```text
Claude Code / Codex agent workflow
  -> 主控仓库扫描、提问、产物生成、Impeccable skill、gap 验证和代码 patch

local HTML workbench
  -> 承载用户看、选、评审、确认和 live review 入口

ADW CLI substrate
  -> 提供 Flow Ledger、artifact、gap、detect、delta gate、handoff/import 等确定性动作
```

核心工程目标不是一次性生成漂亮页面，而是把一条需求 flow 的状态、产物、门禁和修复历史串起来，保证它能中断、续跑、复盘和重复执行。

当前 T0-T13 已跑通的是 ADW fallback 薄闭环，但需要清债后才能作为目标架构底座：

```text
已有项目 retrospective
  -> 确认 / 生成 Product Context 和 DESIGN.md
  -> 一句话需求
  -> 苏格拉底式探索循环
  -> 2-3 个 HTML 原型方向
  -> 用户选择 / 合并
  -> docs/design-<flow>.md + docs/design-<flow>.html
  -> ADW fallback 设计稿审查门（需改为 ADW gate + skill import）
  -> 代码实现
  -> token / DOM / 自写 detector 阻塞检查（需替换为 impeccable detect）
  -> state / interaction not-run
  -> a11y 提醒
  -> 自动修复确定性问题
  -> live workbench + PatchIntent
  -> FlowRun 通过记录
```

必须清理的名实差距：

- `document` / `critique` / `live` / `polish` 是 agent skill，不能写成 ADW CLI 直接调用。
- 自写 detector 是错误替代实现，必须从主路径删除并替换为 `impeccable detect --json`。
- `design:bootstrap` 的扫描 seed 只能是 handoff context / draft，不得包装成完整 DESIGN.md 生成。
- `design:review` 的 judgment input 只能是证据门禁和 import 校验，不得包装成 Impeccable critique。
- 未实现运行期 state / interaction driver；空、加载、错误、边界数据等状态目前只能在设计门静态把关，gap 运行期诚实标 `not-run`。
- **flow 生命周期命令缺失，闭环实际是断的（命门级硬伤）。** `createFlow`、`recordQuestionAnswer`、`approveDesign`、`markDone` 四个 FlowAction 有定义和 invariant，但没有任何 CLI 命令能触发：`store.create()` 全程零调用，`approveDesign` 只出现在注释和 resume 提示里。后果是这套 CLI 自己**创建不了 flow**（任何命令第一步 `read(slug)` 在 flow 不存在时直接抛错）、`design:review` 通过后**进不了 code 阶段**（导致 Code 工作台 T9-T13 经 CLI 不可达）、也**到不了 `done` 终态**、记录不了探索问答。因此「T0-T13 闭环已验证」属于 overclaim，必须改为「闭环命令待接线」（见 T16）。
- **gap 名实不符：当前不和设计稿 baseline 做 diff。** 文档把 gap 定义为「设计产物和代码实现之间的差异」，但 `analyzeSnapshot` 从不加载 `design-<flow>.html`；`dom` 检查只是「页面非空白 + 有 title/h1」的体检，`token` 比的是全局 `DESIGN.md` 调色板而非设计稿。真正的「实现页 vs 设计稿」语义/DOM diff 尚未实现（见 T18）。
- **B 主流程缺编排入口。** 「Agent 主控」目前只有散文描述，没有一个具体的 agent skill / workflow 入口告诉 Claude Code / Codex 怎么按 Proposal → Design → Code 调 `adw` 命令。这是「B + A」里 B 的落点，必须补成具体任务（见 T17）。

## 2. MVP 默认决策

| 问题 | MVP 默认 | 原因 |
| --- | --- | --- |
| 用户入口 | Codex / Claude 中的 agent workflow | 目标用户本来就在 AI harness 中使用 |
| 用户界面 | 本地 HTML workbench | 原型、设计稿、gap report 都需要可视化决策 |
| CLI 定位 | ADW 是 agent 可调用的确定性底座 | 不把 CLI 伪装成完整智能流程主控 |
| live 修改 | 当前是 live workbench + PatchIntent；真实修改走 agent `/live` handoff | `/live` 是 skill，不是已证明可 spawn 的 CLI |
| Flow 状态 | `docs/design-<flow>.workflow.json` | 把一条 flow 的状态和产物绑住 |
| 需求级设计文档 | `docs/design-<flow>.md` | 需求权威记录，不污染根 `DESIGN.md` |
| 正式 HTML 设计稿 | `docs/design-<flow>.html` | 用户审阅载体和 gap baseline |
| Proposal HTML | `docs/proposal-<flow>.html` | 方案发散和选择页 |
| gap report | `docs/assets/<flow>/gap-report-<runId>.json/html` + latest 摘要 | 每轮独立保存，机器消费和用户审阅分离 |
| `PRODUCT.md` | 短期保留根目录兼容文件 | 兼容 Impeccable；当前不代表已调用 Impeccable |
| `DESIGN.md` 更新 | 只允许 delta proposal + 当前操作者确认 | 防止 agent 后台污染全局设计语言 |
| MVP 运行期阻塞检查 | token / DOM / `impeccable detect --json` | detector 来源必须是真 Impeccable CLI |
| MVP 运行期 not-run | state / interaction | 缺状态 / 交互驱动，不能假装已验证 |
| MVP 提醒检查 | a11y | 先记录噪声，阶段 2 再升级稳定规则 |
| screenshot | visual evidence | 不作为默认阻塞标准 |

## 3. 范围

### 3.1 做

- 定义 FlowRun 状态机和产物台账。
- 定义 artifact layout 和配置。
- 接入可配置 HTML 模板 registry，不硬编码本机路径。
- 先用本仓库已有 `DESIGN.md`、`PRODUCT.md`、`.impeccable/` 和 `docs/design-<flow>.md/html` 做 Stage 0 retrospective。
- 实现项目上下文扫描：README、AGENTS、CLAUDE、docs、package、routes、CSS、tokens、组件、现有页面。
- 生成或确认 `PRODUCT.md` / `DESIGN.md`；ADW 负责 handoff context、draft、确认页和 delta gate，Impeccable `/document` 由 agent 执行后导入。
- 生成 `DESIGN.md` HTML 可视化确认页。
- 实现 Proposal / Prototype 的苏格拉底探索循环和 HTML 原型发散。
- 生成需求级 `docs/design-<flow>.md` 和 `docs/design-<flow>.html`。
- 实现设计稿审查门：deterministic rules + judgment review。
- 实现 Code 工作台的最小 gap loop。
- 自动修复确定性问题，最多三轮。
- 将 live workbench 作为人工局部修复入口；真实修改由 agent `/live` handoff 或未来经验证的 live server adapter 完成。
- 记录 PatchIntent、gap history 和 resume pointer。

### 3.2 不做

- 不做完整 SaaS / Web 平台。
- 不做团队权限、审批流、资产商城。
- 不做 Sketch adapter。
- 不做 Figma / Sketch 替代编辑器。
- 不做多 design profile UI。
- 不做任意页面像素级自动还原。
- 不把 interaction / a11y 在 MVP 中直接作为全部阻塞检查。
- 不把 live 当成纯静态 HTML 能力。
- 不让 agent 后台静默改根 `DESIGN.md`。
- 不把 ADW fallback detector / critique / DESIGN.md seed 保留为主路径；错误替代实现必须删除或改成显式 handoff / import。

## 4. 目录和产物约定

```text
docs/
  proposal-<flow>.html                 # Proposal 阶段 HTML 原型集合
  design-<flow>.md                     # 需求级正式设计产物
  design-<flow>.html                   # 正式 HTML 设计稿
  design-<flow>.workflow.json          # FlowRun 状态和产物台账
  tasks-<flow>.md                      # 可选的具体实现任务
  assets/<flow>/
    gap-report-<runId>.json            # 单轮机器可读 gap report
    gap-report-<runId>.html            # 单轮用户可读 gap report
    gap-report-latest.json             # 指向最新一轮的机器可读摘要
    gap-report-latest.html             # 指向最新一轮的用户可读摘要
    screenshots/                       # visual evidence
    patches/                           # 独立 diff、patch 摘要或引用

DESIGN.md                              # 根目录全局设计语言，低频更新
PRODUCT.md                             # MVP 兼容 Impeccable
.impeccable/design.json                # Impeccable sidecar
```

命名规则：

- `<flow>` 使用短横线 slug，例如 `mobile-checkout-onboarding`。
- 创建 flow 前必须查重；如果 `docs/design-<flow>.workflow.json` 或同名核心产物已存在，必须提示用户换名、复用已有 flow，或自动追加短后缀。
- Markdown 是权威记录，HTML 是主要审阅载体。
- HTML workbench 负责展示决策上下文；MVP 中不要求静态页面自动回写状态，用户决策由对话口述给 agent，再由 orchestrator 落 action。
- 真正改运行页面的 live 路径由 agent 执行 Impeccable `/live`，或复用未来经验证可脚本化的 live server/session。
- `docs/design-<flow>.workflow.json` 是内部控制面，不要求用户理解字段。

## 5. FlowRun 状态机和产物台账

### 5.1 用户感知

用户只需要看到：

```text
当前在哪一步
现在需要我决定什么
已经有哪些产物
为什么不能继续
```

不要把 `flowId`、`resumePointer`、`artifactRefs` 等字段暴露成用户必须学习的概念。它们可以出现在高级详情里，但默认以人话展示。

### 5.2 内部状态

`docs/design-<flow>.workflow.json` 至少包含：

| 字段 | 用途 |
| --- | --- |
| `flowId` | 绑定同一需求下的所有产物 |
| `title` | 用户可读标题 |
| `currentStage` | `proposal` / `design` / `code` / `done` |
| `currentGate` | 当前阻塞门禁，例如 `prototype-selection`、`design-review`、`gap-blocking-check`、`live-review` |
| `artifactRefs` | proposal HTML、design md/html、gap report、PatchIntent、patch 等路径 |
| `designVersion` | 进入设计稿审查门时使用的 `DESIGN.md` version 或 hash |
| `reviewStatus` | 设计稿审查门状态和阻塞原因 |
| `gapHistory` | 每轮 gap 检查、自动修复前后、剩余提醒项和 report refs |
| `patchIntentHistory` | 每次自动修复或 live 修改的目的、范围和复验要求 |
| `resumePointer` | 中断后下一步要执行的 action |
| `eventLog` | append-only 关键事件 |

### 5.3 状态推进 action

大模型不能直接“凭记忆”推进阶段。orchestrator 必须通过显式 action 推进。下表是 **agent 可调用契约**：每个 action 对应一个 `adw` 命令，agent 只能通过这些命令推进 flow，不能直接写 `workflow.json`。

| Action | CLI 命令 | 接线状态 | 允许前置条件 | 结果 |
| --- | --- | --- | --- | --- |
| `createFlow` | `adw flow:create <dir> <slug> <title>` | ✗ 待接线（T16） | 有需求输入和项目上下文 | 创建 workflow ledger |
| `recordQuestionAnswer` | `adw proposal:answer <dir> <slug> <q> <a> [flags]` | ✗ 待接线（T16） | 当前在 Proposal 探索循环 | 更新假设和未解决分歧 |
| `attachPrototype` | `adw proposal:generate <dir> <slug> <directions.json>` | ✓ 已接线 | 已生成 proposal HTML | 记录候选方向 |
| `approvePrototype` | `adw proposal:approve <dir> <slug> <selection>` | ✓ 已接线 | 用户选择 / 合并方向 | 进入 Design |
| `attachDesignArtifact` | `adw design:flow-generate <dir> <slug> <spec.json>` | ✓ 已接线 | 已生成 design md/html | 记录正式设计产物 |
| `runDesignReview` | `adw design:review <dir> <slug> <judgment.json>` | ✓ 已接线 | design md/html 存在，`DESIGN.md` version 已记录 | 写入 review status |
| `approveDesign` | `adw design:approve <dir> <slug>` | ✗ 待接线（T16） | 审查门通过，用户确认 | 进入 Code |
| `attachImplementationTarget` | `adw code:target <dir> <slug> <route> [--no-auth]` | ✓ 已接线 | 有目标 route / URL 和已登录会话 | 准备 gap loop |
| `attachGapReport` | `adw gap:run <dir> <slug> <url> [--storage f]` | ✓ 已接线（采集成功自动 attach） | gap report schema 通过 | 写入 gap history |
| `recordPatchIntent` | `adw live:record <dir> <slug> <purpose> [flags]` | ✓ 已接线 | 有 patch 或 live 修改 | 写入 patchIntentHistory |
| `markDone` | `adw flow:done <dir> <slug> [--accept-warnings]` | ✗ 待接线（T16） | 阻塞检查通过，用户接受剩余提醒 | 完成 flow |

> 「接线状态」列以本文档为准：✗ 标记的四个命令是 T16 的交付物。在它们接线前，flow 无法经 CLI 创建、无法从 Design 进入 Code、无法收尾，所谓「闭环」不成立。

每个 action 前都要跑 invariant check。缺产物、缺状态清单、`DESIGN.md` 版本不一致、审查门未过或 gap report schema 不合法时，必须阻塞并给用户人话原因。

## 6. 核心模块

```text
Design Workflow Orchestrator
  -> Flow Ledger Store
  -> Project Scanner
  -> Template Registry Adapter
  -> Product Context Adapter
  -> Agent Skill Handoff / Import
  -> Impeccable Detect Adapter
  -> DESIGN.md Bootstrapper
  -> Proposal / Prototype Engine
  -> Design Artifact Engine
  -> Review Gate Engine
  -> Code Gap Engine
  -> Auto Fix Engine
  -> Live Repair Bridge
```

| 模块 | 职责 | MVP 实现方式 |
| --- | --- | --- |
| Orchestrator | 执行 action、跑 invariant、推进 stage/gate | ADW CLI，被 agent 调用 |
| Flow Ledger Store | 读写 `docs/design-<flow>.workflow.json` | JSON schema + append-only event log |
| Project Scanner | 读取仓库上下文和现有设计信号 | 本地文件扫描 + 可选浏览器采样 |
| Template Registry Adapter | 提供 HTML 模板清单和示例 | 路径或 package 可配置 |
| Product Context Adapter | 维护产品调性上下文 | MVP 读写 `PRODUCT.md` |
| Agent Skill Handoff / Import | 把 `/document`、`/critique`、`/polish`、`/live` 等 skill 交给 agent 执行并导入结果 | P0 新增 |
| Impeccable Detect Adapter | 调用 `impeccable detect --json` 并解析 findings | P0 新增，替换自写 detector |
| DESIGN.md Bootstrapper | 生成/确认全局设计语言 | ADW 生成 handoff context / draft / 确认页，导入 agent `/document` 结果 |
| Proposal Engine | 苏格拉底探索、发散、收敛 | 会话状态 + 决策树 + HTML 候选页 |
| Design Artifact Engine | 生成需求级设计文档和正式 HTML | `docs/design-<flow>.md/html` |
| Review Gate Engine | 设计稿审查门 | ADW deterministic + `impeccable detect --json` + agent `/critique` import 证据门禁 |
| Code Gap Engine | 设计稿和实现页面比对 | token/DOM/Impeccable detect 阻塞；state/interaction not-run；a11y 提醒 |
| Auto Fix Engine | 修复确定性问题 | 最多三轮，patch 可回滚 |
| Live Repair Bridge | 人工局部修复 | live workbench + PatchIntent + agent `/live` handoff；可脚本化 live server 单独 spike |

## 7. 任务拆分

### T0：配置和 artifact 协议 `[Stage 1 | depends: none]`

交付：

- 定义 `ai-design-workflow.config.json` 或等价配置。
- 配置字段至少包括：
  - `artifactDir`，默认 `docs/`。
  - `templateRegistry`，支持 path 或 package id。
  - `designMdPath`，默认 `DESIGN.md`。
  - `productContextMode`，MVP 为 `product-md-compatible`。
  - `defaultViewports`，至少包含 H5 mobile。
  - `gap.blockingChecks`，当前默认 `token/dom/detector`。
  - `gap.warningChecks`，当前默认 `interaction/a11y`；其中 interaction 在 driver 未实现前会输出 `not-run`。
  - `gap.maxAutoFixRounds`，默认 3。
  - `htmlWorkbenchMode`，MVP 默认为 `static-decision-via-agent`。
  - `flowSlugConflictPolicy`，默认 `prompt-or-append-suffix`。
  - `gap.runIdFormat`，默认按时间戳或递增轮次生成。

验收：

- 不出现本机绝对路径硬编码。
- 配置缺失时给出可执行的修复提示。
- 产物路径全部落在 `docs/` 或仓库根的明确兼容文件。
- 创建 flow 时执行 slug 查重，不能覆盖已有 flow 核心产物。

### T1：Flow Ledger Store `[Stage 1 | depends: T0]`

交付：

- `docs/design-<flow>.workflow.json` schema。
- FlowRun 创建、读取、更新、续跑。
- append-only `eventLog`。
- action 前 invariant check。
- gap history 记录每轮 `gap-report-<runId>.json/html`，并维护 latest ref。
- 用户可读状态摘要：
  - 当前步骤。
  - 当前需要决策。
  - 已有产物。
  - 阻塞原因。

验收：

- 同一 flow 中断后能从 `resumePointer` 继续。
- 第二条 flow 不会覆盖第一条 flow 的产物。
- 缺关键产物时不能靠模型继续编造下一步。
- gap report 历史可追踪，不被最新一轮覆盖。

### T2：模板 registry 接入 `[Stage 1 | depends: T0]`

交付：

- 读取模板列表：id、name、scenario、surface、description、example HTML。
- 支持按场景推荐：
  - H5 单屏：`mobile-app`
  - H5 多屏：`mobile-onboarding` + `mobile-app`
  - PRD / 需求说明：`pm-spec`
  - gap report：`data-report` / `dashboard`
  - 技术交接：`eng-runbook` / `docs-page`
- 生成 HTML 前必须选择模板或显式声明 fallback shell。

验收：

- 模板来源可配置。
- 用户可以覆盖系统推荐模板。
- 生成 HTML 可作为静态文件打开，不依赖模板仓库运行时服务。
- MVP 的静态 HTML workbench 只负责展示和辅助决策，不负责把点击事件自动写回 Flow Ledger；真实状态推进由用户在对话中确认，再由 orchestrator 执行 action。

### T3：项目扫描和 Stage 0 retrospective `[Stage 0 | depends: none]`

交付：

- 扫描 README、AGENTS、CLAUDE、docs、package、routes、CSS、tokens、组件、已有页面。
- 输出 `ProjectContextSnapshot`：
  - 项目目的和用户假设。
  - 技术栈和本地启动方式。
  - 已有设计信号。
  - 现有 `DESIGN.md` / `PRODUCT.md` / `.impeccable/` 状态。
  - 已有 `docs/design-<flow>.md/html` 质量样本。
- Stage 0 先抽样回顾本仓库已有设计产物，不先另选绿地仓库。

验收：

- 能判断已有设计产物是否缺目标 route、状态清单、验收规则。
- 能发现当前设计产物对 gap loop 的缺口。
- retrospective 形成可执行的改进清单。

### T4：Product Context 和 DESIGN.md 冷启动 `[Stage 0/1 | depends: T0,T3]`

交付：

- 缺 `PRODUCT.md` 时生成或确认 Product Context。
- 缺 `DESIGN.md` 时，ADW 可以从代码 / CSS 扫描种子生成 `DESIGN.md.draft`，但必须明确标记为 handoff draft，不是完整设计语言生成。
- agent 在 Claude Code / Codex 中执行 Impeccable `/document` 后，ADW 通过 import / confirm 写入最终 `DESIGN.md`。
- 已有 `DESIGN.md` 时不静默覆盖。
- 生成 `docs/design-system-confirmation.html`：
  - 产品调性摘要。
  - 色板、字体、组件样例。
  - H5 屏幕片段。
  - Do / Don't。
  - 从代码 / 截图抽取的证据。

验收：

- 用户确认前不写最终根 `DESIGN.md`，或只写明确标记的 draft。
- 确认页美观，基于模板或设计系统 shell。
- 写入后记录 `designVersion`。
- seed draft 必须在输出中明确提示“需 agent 执行 Impeccable /document 或人工补全”，不能伪装成完整设计语言生成。

### T5：Proposal / Prototype 探索循环 `[Stage 1 | depends: T1,T3,T4]`

交付：

- 支持一次只问一个问题。
- 每问提供推荐答案，并解释为什么影响方案。
- 维护：
  - 当前假设。
  - 已确认决策。
  - 未解决分歧。
  - 下一问。
  - 收敛条件。
- 通过 Flow Ledger 记录关键问答和决策。

验收：

- 一句话需求不会直接进入生码。
- 探索循环不变成长问卷。
- 信息足够时能主动收敛到原型发散。

### T6：HTML 原型发散 workbench `[Stage 1 | depends: T1,T2,T5]`

交付：

- 生成 `docs/proposal-<flow>.html`。
- 页面包含 2 到 3 个候选方向，每个方向说明：
  - 探索主轴。
  - 适合场景。
  - 取舍。
  - H5 原型。
- 用户可以选择、合并、否决或要求下一轮变体。
- `approvePrototype` 写入 Flow Ledger。

验收：

- HTML 候选方向美观，基于模板 registry。
- 移动端关键 viewport 不溢出、不遮挡。
- 用户能从 HTML 中判断方向差异。
- MVP 不要求用户点击 HTML 后自动写回；用户在对话里说出选择、合并或否决结果，agent 调用 `approvePrototype` 或继续发散。

### T7：需求级正式设计产物 `[Stage 1 | depends: T1,T2,T6]`

交付：

- 生成 `docs/design-<flow>.md`，包含：
  - 背景和目标。
  - 用户和场景。
  - 被选方向和取舍。
  - 信息架构和主路径。
  - 机器可读的屏幕清单。
  - 机器可读的状态清单：空、加载、错误、成功、边界数据。
  - 每个状态的驱动方式：mock 响应、query 参数、fixture、feature flag、seed data 或人工不可测说明。
  - 目标 route / URL。
  - H5 约束：safe-area、键盘、底部操作区、tap target。
  - 验收规则清单。
  - 引用的 `DESIGN.md` version 或 hash。
  - HTML 设计稿路径。
- 生成 `docs/design-<flow>.html`，作为正式设计稿和 gap baseline。

验收：

- 需求级文档不复制根 `DESIGN.md` 的全部内容。
- 如果设计稿偏离根 `DESIGN.md`，必须记录偏离理由。
- 没有机器可读状态清单时，不能进入 Code。
- 声明为可检查的状态必须有状态驱动方式；没有驱动方式的状态只能在 gap report 中标记为 `not-testable`，不能算通过。

### T8：设计稿审查门 `[Stage 1 | depends: T1,T7]`

交付：

- ADW deterministic rules：
  - `DESIGN.md` token 使用。
  - H5 viewport。
  - safe-area。
  - tap target。
  - 关键状态覆盖。
  - overflow。
  - 设计稿 a11y。
  - `impeccable detect --json` 反模式。
- judgment review / critique import：
  - 信息架构。
  - 主路径。
  - 产品命题。
  - 关键文案和状态。
  - 每条致命意见必须绑定屏幕、元素、文本或交互证据。
- 评审结论写回 `docs/design-<flow>.md` 和 Flow Ledger。
- Impeccable `/critique` 由 agent 执行，ADW 导入结构化评审并负责汇总、证据门禁和 Flow Ledger 写回。

验收：

- deterministic rules 未通过时直接阻塞。
- judgment review 只有带证据的致命问题能阻塞。
- 评分不作为唯一阻塞条件。
- 设计稿 a11y 阻塞是有意策略；实现页面 a11y 在 MVP 先提醒。
- 当前审查门不得作为“已复用 Impeccable critique”的验收依据；只有导入 agent `/critique` 结果才算 critique 复用。

### T9：Code 工作台接入 `[Stage 1 | depends: T1,T8]`

交付：

- Code 工作台读取：
  - `docs/design-<flow>.workflow.json`
  - `docs/design-<flow>.md`
  - `docs/design-<flow>.html`
  - `DESIGN.md`
- 生成或修改代码。
- 启动页面并用浏览器自检。
- 目标 route / URL 来自 `docs/design-<flow>.md`。
- 读取 `docs/design-<flow>.md` 中声明的状态驱动方式，并在进入 gap loop 前确认哪些状态可测。

验收：

- 实现 agent 不直接改根 `DESIGN.md`。
- 如果实现发现设计产物矛盾，回到 Design 修订。
- gap 检查默认复用已登录浏览器会话；不把登录流程作为本地 gap loop 责任。
- 无法驱动的状态必须回写为 `not-testable` 或回到 Design 补驱动方式，不能静默跳过。

### T10：最小 gap engine `[Stage 1 | depends: T1,T7,T9]`

交付：

- 输入：
  - Flow Ledger。
  - Design HTML baseline。
  - implementation page URL。
  - `DESIGN.md` version。
  - viewport 列表。
  - 状态驱动方式清单。
- 可比区域准备：
  - HTML 设计稿必须标记可比主体区域，例如 `data-design-surface="main"`。
  - 手机壳、状态栏、注释、标尺、候选说明等审阅 chrome 必须标记为不可比区域，例如 `data-design-chrome`。
  - implementation page 需要通过 route、selector 或 main landmark 定位对应主体区域。
  - 没有可比区域标记时，DOM / token diff 只能降级为提醒或要求回到 Design 补标记。
- 状态驱动：
  - `empty`：fixture、query 参数或 mock 空响应。
  - `loading`：延迟 mock、loading flag 或可控 suspense 状态。
  - `error`：mock 500、rejected promise 或错误 fixture。
  - `success`：默认成功 fixture。
  - `boundary`：长文本、大列表、零值、最大值、异常字符等 fixture。
  - 无法驱动的状态标记为 `not-testable`，并进入提醒项或 Design 修订建议。
- 阻塞检查：
  - token / rule diff。
  - DOM / semantic diff。
  - detector：来源必须是 `impeccable detect --json`。
- not-run：
  - state coverage（直到 state driver 完成）。
  - interaction diff（直到 interaction driver 完成）。
- 提醒检查：
  - accessibility diff。
- 证据：
  - Playwright screenshot。
  - optional masked diff。
- 输出：
  - `docs/assets/<flow>/gap-report-<runId>.json`
  - `docs/assets/<flow>/gap-report-<runId>.html`
  - `docs/assets/<flow>/gap-report-latest.json`
  - `docs/assets/<flow>/gap-report-latest.html`

实现口径：

- DOM diff 不做逐节点像素级或源码级对齐，只比较语义层：关键文本、role、主要区块、可交互元素、状态容器和验收选择器。
- token diff 先 normalize 再比较：颜色统一成 RGBA，单位统一成 px，数值允许小数舍入，字体允许 fallback 族，line-height / letter-spacing / opacity 允许配置容差。
- chrome 剥离和 token 容差必须写入 gap report，方便判断误杀来源。

> **当前实现差距（必须写实）：** 现版 `gap:run` **不加载 `design-<flow>.html` 做 baseline diff**。`dom` 检查只是「页面非空白 + 有 title/h1」的体检；`token` 比的是全局 `DESIGN.md` 调色板，不是设计稿。也就是说本节描述的「实现页 vs 设计稿」语义/DOM diff 仍是目标态，落地见 **T18**。在 T18 完成前，文档不得宣称 gap 已经在对齐设计稿。

验收：

- gap report schema 通过后才能写入 Flow Ledger。
- screenshot 不作为默认阻塞标准。
- state / interaction 当前必须诚实输出 `not-run`，不能算通过。
- a11y 在 MVP 只提醒，不自动挡住 flow。
- 明显 token、DOM、detector 问题能阻塞。
- 可比区域缺失时不会强行做高置信 DOM / token 阻塞判断。
- 每轮 gap report 有独立 `runId`，历史不被覆盖。

### T11：自动修复 loop `[Stage 1 | depends: T1,T10]`

交付：

- 根据 gap report 自动修复确定性问题。
- 默认最多 3 轮。
- 每个 patch 只处理一类问题。
- 每轮重新跑 deterministic checks。
- 写入 gap history 和 patch intent。
- 每个 patch 保存为独立 diff 文件或独立 patch ref；是否创建 git commit 由用户或仓库策略决定，不强制污染 git 历史。

验收：

- 修复后阻塞问题数量必须下降。
- 不下降、出现新高风险问题或需要猜产品意图时立即停止。
- patch 必须可单独回滚。
- 自动修复不会改根 `DESIGN.md`。
- 主观问题进入人工 live。

### T12：Human Live Review `[Stage 1 | depends: T1,T10,T11]`

交付：

- HTML workbench 提供 live review 入口、问题列表、区域选择和确认动作。
- MVP 中 HTML workbench 的确认动作可以由用户在对话里口述完成，再由 agent 执行 `recordPatchIntent`；不要求静态页直接写状态。
- 当前实现：只生成 live workbench、记录 PatchIntent 和 metrics。
- 真实修改：agent 执行 Impeccable `/live` 后，ADW 导入 PatchIntent / patch refs / 复验要求；底层 live server/session 是否可脚本化另做 spike。
- 每次 live patch 记录 `PatchIntent`：
  - 改动目标。
  - 关联设计规则。
  - 影响范围。
  - 是否需要重新跑 gap。
  - 耗时和结果。

验收：

- live 不作为第一道调试入口。
- 接受 patch 后必须重新跑相关 gap。
- 记录 live 耗时、成功率、返工次数和用户放弃点。
- 当前实现不能宣称已经完成真实 live 修改，只能宣称完成 live gate、workbench、handoff 和 PatchIntent 记录。

### T13：DESIGN.md 更新门禁 `[Stage 1 | depends: T1,T8,T10]`

交付：

- 只生成 `DESIGN.md delta proposal`，不后台静默写入。
- delta proposal 包含：
  - provenance。
  - 变更前后差异。
  - 影响的 token / 组件 / 规则。
  - HTML 可视化确认页。
- 当前操作者显式确认后才写根 `DESIGN.md` 和 sidecar。

验收：

- 未批准的变化只留在 `docs/design-<flow>.md`。
- 根 `DESIGN.md` 更新频率保持低频。
- 需求级文档引用更新后的 version 或 hash。

### T14：Impeccable Detect Adapter + Skill Handoff Boundary `[P0 | depends: T4,T8,T10,T12]`

交付：

- 新增 `Impeccable Detect Adapter`：
  - 直接调用 `impeccable detect --json <file|dir|url>`。
  - 解析 JSON findings：`antipattern`、`severity`、`snippet`、`file`、`line`、`description`。
  - 接受 exit code `0` 和 `2`：`2` 代表发现问题，不代表调用失败。
  - 对 command missing、timeout、stdout 非 JSON 明确输出 failed / not-run，不得退回自写 detector。
- 删除 ADW 自写 detector 主路径：
  - `design:review` 的 detector finding 只能来自 Impeccable detect。
  - `gap:run` 的 detector check 只能来自 Impeccable detect。
  - 如果 detector 被配置为 blocking，而 detect 不可用，则必须阻塞或显式报告 detector 未运行，不能算通过。
- 建立 Agent Skill Handoff / Import 边界：
  - `/document`、`/critique`、`/polish`、`/audit`、`/live` 不由 ADW CLI spawn。
  - ADW 生成 handoff context：flow、DESIGN.md hash、design-<flow>.md/html、目标 route、当前 gate、期望输出 schema。
  - agent 在 Claude Code / Codex 中执行对应 Impeccable skill。
  - ADW 导入 agent skill 输出，校验 provenance 和 schema，再写 Flow Ledger / report / docs。

具体命令与文件格式（本任务必须钉死，不能停留在散文）：

| 命令 | 行为 | 落盘 |
| --- | --- | --- |
| `adw handoff:<skill> <dir> <slug>` | 生成 handoff context 包 | `docs/assets/<flow>/handoff-<skill>-<runId>.json` |
| `adw import:<skill> <dir> <slug> <result.json>` | 校验 schema + provenance，写回 ledger / docs / report | 更新对应 artifact + `eventLog` + `resumePointer` |

- `<skill>` ∈ `document | critique | polish | audit | live`。
- handoff context JSON 字段：`flowId`、`stage`、`gate`、`designVersion`（DESIGN.md hash）、`inputRefs`（design-<flow>.md/html、目标 route、相关 gap report）、`expectedOutputSchema`（agent 应产出的结构）。
- import result JSON 必须带 provenance：`source: agent-skill`、`skill`、`agentHarness: codex | claude-code | other`、`inputRefs`、`outputRefs`、`designVersion`、`confirmedBy`。schema 校验不过、provenance 缺失或 `designVersion` 与当前 ledger 不一致时，import 必须拒绝并给人话原因，不得部分写入。
- MVP 先实现 `document` 与 `critique` 的 handoff/import；`polish` / `audit` / `live` 复用同一命令骨架，按优先级补 schema。
- 清理错误 fallback：
  - `design:bootstrap` 保留 draft / 确认页 / delta gate，但不能宣称运行 `/document`。
  - `design:review` 保留 deterministic gate / evidence gate，但不能宣称运行 `/critique`。
  - `live:*` 保留 workbench / PatchIntent / metrics，但不能宣称真实运行 `/live`。

验收：

- 代码中存在明确 `impeccable-detect` adapter 层，而不是在各命令里散落调用逻辑。
- ADW 自写 detector 规则被删除或不再被任何主路径引用。
- design review 和 gap report 能记录 detector 来源：`source: impeccable-detect`。
- `document` / `critique` / `polish` / `audit` / `live` 在文档、命令输出和代码注释中都不再写成 ADW CLI 可直接调用。
- handoff context 和 import schema 至少覆盖 `/document` 与 `/critique`，后续再扩到 `/polish`、`/audit`、`/live`。

### T15：State / Interaction Driver `[P0 | depends: T7,T9,T10]`

交付：

- **先扩 spec schema（前置硬伤）。** 当前 `ScreenStateSchema` 只有 `{id, screenId, kind, description}`，**没有 `driver` 字段**，`readinessForCode` 也只校验 `states.length>0`。所以「每个状态的驱动方式」目前无处声明、无法校验——T15 必须先给 `ScreenStateSchema` 加 `driver`（类型 + 参数），并让 `readinessForCode` 要求每个状态要么有 driver、要么显式 `not-testable`。在此之前 T7 的「声明驱动方式」是写在文档里、schema 落不下的空头承诺。
- 为 `docs/design-<flow>.md` 中的状态驱动方式建立运行时执行协议：
  - mock response。
  - fixture。
  - query param。
  - feature flag。
  - seed data。
  - test hook。
- gap loop 能把实现页推进到声明状态：
  - empty。
  - loading。
  - error。
  - success。
  - boundary。
- interaction driver 能执行关键交互：
  - click。
  - input。
  - expand / collapse。
  - scroll。
  - keyboard / safe-area 相关场景。
- 对无法驱动的状态或交互输出 `not-testable`，并给出补驱动建议。

验收：

- state 不再默认 `not-run`；有 driver 的状态必须真实采集并生成检查结果。
- interaction 不再默认 `not-run`；有 driver 的交互必须真实执行并记录结果。
- 没有 driver 的状态 / 交互不能静默通过。
- driver 失败不导致整个 gap loop 崩溃，而是写入 failed / not-testable report。

### T16：Flow 生命周期命令闭环 `[P0 | depends: T1]`

背景：`createFlow` / `recordQuestionAnswer` / `approveDesign` / `markDone` 四个 FlowAction
有定义和 invariant，但没有任何 CLI 命令能触发，导致 flow 经 CLI 不可创建、不可从 Design
进入 Code、不可收尾。这是「闭环已验证」overclaim 的根因。

交付：

- 接线四个命令，命令名与 §5.3 契约表一致：
  - `adw flow:create <dir> <slug> <title>` → `createFlow`。
  - `adw proposal:answer <dir> <slug> <q> <a> [--assumption/--resolved/--new-open/--dimension]` → `recordQuestionAnswer`。
  - `adw design:approve <dir> <slug>` → `approveDesign`（审查门 `passed` 才放行）。
  - `adw flow:done <dir> <slug> [--accept-warnings]` → `markDone`。
- 每个命令复用既有 `store.apply` + invariant 路径，不绕过门禁。
- 命令输出人话：当前阶段、下一步 `resumePointer.hint`，被 invariant 挡住时给原因。

验收：

- 从零开始可经 CLI 跑通：`flow:create` → 探索/`proposal:answer` → `proposal:generate` → `proposal:approve` → `design:flow-generate` → `design:review` → `design:approve` → `code:target` → `gap:run` → `flow:done`，全程不手改 `workflow.json`。
- `flow:done` 在最近一轮 gap 仍有阻塞、或有提醒但未 `--accept-warnings` 时被挡住。
- `design:approve` 在审查门未通过时被挡住。
- §9 验收清单里依赖「可创建 / 可续跑 / 可收尾」的条目，只有本任务完成后才能勾选。

### T17：ADW Agent 编排入口（skill / workflow） `[P0 | depends: T1,T16]`

背景：「Agent 主控」是 B 主流程的核心，但此前只有散文描述，没有具体入口。本任务把它落成可安装、可被 Claude Code / Codex 读取的编排 skill——这是「B + A」里 B 的落点。

形态（本任务确定）：

- 一个**编排 skill**，随 ADW 包分发，安装进目标仓库：
  - 主形态：Claude Code skill（`SKILL.md` + 说明），装到目标仓库 `.claude/skills/adw-workflow/`。
  - 兼容形态：同等内容的 `AGENTS.md` 片段，供 Codex / 其它 harness 读取。
- skill 不自己实现逻辑，只编排：它告诉 agent **何时调哪个 `adw` 命令、何时做 Impeccable skill handoff**，并以 `adw flow:status` 的 `resumePointer` 为单一事实源决定下一步。
- skill 内容至少覆盖：
  - 三工作台推进顺序（Proposal → Design → Code）与每步对应的 §5.3 命令。
  - 何时 `handoff:<skill>` / `import:<skill>`（document / critique / polish / audit / live）。
  - 如何把用户在 HTML workbench 里的口述决策翻译成 action 命令（static-decision-via-agent）。
  - 不变量：不手改 `workflow.json`、不后台改 `DESIGN.md`、detector 只来自 impeccable detect。

交付：

- skill / workflow 入口文件与安装方式（`adw` 提供一个安装命令或文档化的拷贝步骤，路径不硬编码）。
- 一份「意图 → 命令序列」对照，让 agent 能从「一句话需求 / 截图 / 改现有页」三种入口正确起步。

验收：

- 一个干净仓库里，agent 只读这个 skill + 跑 `adw flow:status`，就能不靠记忆地推进到下一步。
- skill 描述的每个命令都真实存在于 CLI（与 §5.3 契约表逐条对得上）。
- skill 不重述 Impeccable 能力，只做 handoff；不把 skill 写成「ADW CLI 直接调用 /critique」。

### T18：设计稿 baseline gap diff `[Stage 2 | depends: T7,T10]`

背景：当前 `gap:run` 不加载 `design-<flow>.html`，「实现页 vs 设计稿」的语义/DOM/视觉 diff 尚未实现。这是「设计系统」最该有、却名实不符的能力。

交付：

- gap loop 加载 `design-<flow>.html` 作为 baseline，按 `data-design-surface` / `data-design-chrome` 剥离审阅 chrome 后比对实现页：
  - 语义/文本 diff：关键文本、role、主要区块、可交互元素、状态容器、验收选择器是否缺失或漂移。
  - 可选视觉 diff：masked screenshot 对比，作为证据不作默认阻塞。
- 比对前先做可比区域对齐（设计稿 surface ↔ 实现页 main landmark / selector）；缺标记时降级为提醒或要求回 Design 补标记，不强行高置信阻塞。

验收：

- gap report 能指出「设计稿有、实现页缺」的关键元素 / 文本 / 状态容器，并标 baseline 来源。
- 响应式合理差异不被误判为缺失（容差与 chrome 剥离写入 report）。
- 在 T18 完成前，所有文档对 gap 的描述只能说「实现页 vs DESIGN.md token + detector + spec 存在性」，不得叫「设计产物 diff」。

## 8. 阶段计划

### Stage 0：手动编排验证

目标：用本仓库已有产物验证链路和风险，少写新工程。

顺序：

1. 抽样读取已有 `DESIGN.md`、`PRODUCT.md`、`.impeccable/` 和多组 `docs/design-<flow>.md/html`。
2. 检查需求级文档是否有机器可读状态清单、目标 route、验收规则。
3. 用现有产物手工跑一次设计稿审查门。
4. 对一个已有实现页跑最小 gap：token / DOM / detector 阻塞，state / interaction 标 `not-run`，a11y 提醒，截图做证据。
5. 手工记录一个 Flow Ledger 样例。
6. 如 Impeccable skill 可用，由 agent 手工执行 `/critique` / `/live` / `/polish` 完成一轮修复，并把结果导入 ADW；只跑 CLI 时必须标记为未执行 skill。
7. 记录误判、噪声、修复耗时、产物缺口。

通过标准：

- 能证明 Flow Ledger 需要记录哪些字段。
- 能发现已有设计产物对 gap loop 的缺口。
- 能区分阻塞检查和提醒检查的噪声。
- live 可用，并有耗时和成功率记录。

### Stage 1：MVP

目标：把 Stage 0 手动步骤固化成可重复命令或最小 UI。

当前状态：T0-T13 实现了 ADW fallback MVP 的**大部分模块**——配置、Flow Ledger、模板、扫描、Proposal、Design、Review、Code Context、Gap、Autofix、Live Workbench、DESIGN.md delta gate。但**闭环并未真正打通**：`createFlow` / `approveDesign` / `markDone` / `recordQuestionAnswer` 缺 CLI 命令（见 T16），所以无法从零经 CLI 跑通一条 flow。「T0-T13 已实现并验证」是早期 overclaim，已据实改为「模块基本就位，闭环命令待接线」。

新增：

- 统一 orchestrator 入口。
- Flow Ledger Store。
- 模板 registry 配置。
- HTML workbench 生成。
- 设计稿审查门。
- gap report 标准格式。
- 自动修复安全 loop。
- live PatchIntent 记录。

通过标准：

- 同一套命令可在第二个 flow 上重复跑通。
- 中断后能续跑。
- 产物命名稳定，历史可追踪。
- `DESIGN.md` 不被日常需求污染。
- 不把 fallback 误报为 Impeccable 集成。

### Stage 1.5：P0 清债重构

目标：清掉错误替代实现，把系统重构为 Agent 主控 + ADW 确定性底座，并先把断掉的闭环接上。

新增：

- T16 Flow 生命周期命令闭环（最高优先：闭环命门）。
- T14 Impeccable Detect Adapter + Skill Handoff Boundary。
- T17 ADW Agent 编排入口（skill / workflow）。
- T15 State / Interaction Driver。

（T18 设计稿 baseline diff 归入 Stage 2，因为它依赖 chrome 标记规范稳定后才好降噪。）

通过标准：

- 从零可经 CLI 跑通完整 flow（T16），全程不手改 `workflow.json`。
- `design:review` 和 `gap:run` 的 detector 只来自 `impeccable detect --json`。
- ADW 自写 detector 主路径被删除。
- `design:bootstrap` / `design:review` / `live:*` 不再宣称 CLI 直接调用 `/document`、`/critique`、`/live`。
- 至少具备 `/document` 和 `/critique` 的 handoff / import 协议（命令名 / 文件格式 / schema 见 T14）。
- 有一个可安装的 agent 编排 skill（T17），其描述的命令逐条对得上 §5.3 契约表。
- state / interaction 不再默认 `not-run`；有 driver 的状态和交互能真实采集。
- 保留底座能力标清 `source` 和 provenance，不会和 agent skill 或 Impeccable detect 混淆。

### Stage 2：增强版

目标：提高可靠性和速度。

新增：

- token / DOM / detector 检查降噪和扩大覆盖；state 在 driver 完成后再纳入运行期覆盖。
- 稳定的 interaction / a11y 规则从提醒升级为阻塞。
- H5-first knobs 和本地 deterministic patch。
- Product Context adapter。
- 多 design profile 预留。
- 图片 / HTML 输入解析增强。

### Stage 3：平台化

目标：团队级设计流程平台。

新增：

- 统一网页产品。
- 设计产物 registry。
- 多 design profile。
- 审批和版本历史。
- 评审 overlay。
- CI design gap gate。

注意：CI 不能复用人工已登录浏览器会话，需要程序化登录、测试账号或预置 session。

## 9. 验收清单

MVP 验收必须满足：

已满足（模块级，不依赖闭环命令）：

- [x] 无本机绝对路径硬编码。
- [x] `docs/design-<flow>.workflow.json` 的 schema、读写、append-only eventLog、invariant 已就位。
- [x] 没有把需求级内容写进根 `DESIGN.md`。
- [x] HTML 原型和设计稿可用于评审。
- [x] 设计稿审查门有 deterministic rules 和 judgment review fallback。
- [x] gap report 使用阻塞 / 提醒 / 证据 / not-run 分档。
- [x] 自动修复不会越权改全局设计语言。
- [x] 自动修复 patch 可回滚，且每轮阻塞问题数量必须下降。
- [x] `DESIGN.md` 只有经当前操作者确认的 delta 才会更新。

依赖 T16 接线后才能勾选（此前 overclaim 为 [x]）：

- [ ] 能经 CLI 从零创建 flow（`createFlow` / `flow:create`）。
- [ ] 中断后能经 CLI 续跑（前提是能创建）。
- [ ] 没有跳过 Proposal / Prototype 探索循环，且问答能落账（`recordQuestionAnswer`）。
- [ ] 用户在原型选择、正式设计批准（`approveDesign`）、收尾（`markDone`）处有可执行决策点。

尚未满足的 P0 验收：

- [ ] flow 生命周期四个命令接线，闭环可经 CLI 端到端跑通（T16）。
- [ ] `impeccable detect --json` 被真实接入，而不是 ADW fallback detector。
- [ ] ADW 自写 detector 主路径被删除。
- [ ] `/document` 和 `/critique` 建立 handoff / import 协议（命令名 / 文件格式 / schema），而不是被写成 CLI 直接调用。
- [ ] 有一个可安装的 agent 编排 skill（T17），命令逐条对得上 §5.3 契约表。
- [ ] `live:*` 明确是 workbench / PatchIntent / `/live` handoff，不宣称 CLI 已真实修改页面。
- [ ] state / interaction runtime driver 能真实驱动和验证声明状态 / 交互（含 `ScreenStateSchema` 加 `driver` 字段）。
- [ ] gap 能以 `design-<flow>.html` 为 baseline 做语义/DOM diff（T18），在此之前不叫「设计产物 diff」。

## 10. 风险与缓解

| 风险 | 表现 | 缓解 |
| --- | --- | --- |
| 闭环命令缺失（命门） | action 有定义但无 CLI 入口，flow 创建不了 / 进不了 code / 收不了尾 | T16 接线四个命令；§5.3 契约表逐条标接线状态，杜绝「定义了就当能用」 |
| 模型漏执行约束 | 跳阶段、编造产物、忘记记录 | orchestrator action + invariant check + Flow Ledger |
| Flow 产物散落 | 第二条 flow 开始后无法复盘 | `docs/design-<flow>.workflow.json` 绑定产物 |
| 探索循环变成长问卷 | 用户被连续追问 | 一次只问一个问题，每问给推荐答案，信息足够即发散 |
| HTML 产物丑 | 用户不信任方案 | 强制模板 registry + 浏览器截图检查 |
| `DESIGN.md` 腐化 | 每个需求都改全局规则 | delta proposal + 当前操作者确认 |
| Impeccable 被绕开 | 自建重复能力 | 当前已发生；P0 删除自写 detector，skill 走 handoff / import |
| gap 误判 | 响应式差异或 a11y 噪声误杀 | 阻塞 / 提醒 / 证据三档 |
| screenshot 误导 | 手机壳和状态栏造成大量噪声 | screenshot 只做 visual evidence |
| state / interaction 空挡 | 设计门声明了状态，但运行页没有真实驱动 | P0 做 State / Interaction Driver；未驱动时标 `not-run` / `not-testable` |
| live 名实不符 | 只有 live workbench 和 PatchIntent，没有真实页面修改 | 真实修改走 agent `/live` handoff；接入前不宣称 CLI 已完成 live 修改 |
| live 太慢 | 高频修改都等模型 | 记录 `/live` handoff 数据，阶段 2 加 knobs 和 deterministic patch |
| Product Context 冲突 | README/AGENTS/PRODUCT 各说各话 | MVP 兼容，后续 adapter 化 |
| CI 登录失败 | CI 没有人工浏览器会话 | 阶段 3 引入程序化登录、测试账号或预置 session |

## 11. 仍需确认但不阻塞

1. `/live` 的底层 server/session 是否可脚本化；在证明前只作为 agent skill handoff。
2. `/document`、`/critique`、`/polish`、`/audit`、`/live` 的 import schema 优先级。
3. State / Interaction Driver 优先支持哪类驱动：mock response、fixture、query param、test hook。
4. 模板 registry 是 vendoring 模板，还是作为独立 package 依赖。

## 12. 变更前风险自检

- **复用分析**：`impeccable detect --json` 是可直接复用的 callable tool；`document/critique/audit/live/polish` 是 agent skill，复用方式是 handoff / import，不是 CLI spawn。
- **抽象分析**：Flow Ledger 是必要控制面；新增 callable detect adapter 和 skill handoff / import 两个 seam，避免再次把外部能力散落或误分类。
- **破坏性分析**：重构会改变 detector 结果来源，并删除 ADW 自写 detector 主路径；Flow Ledger / artifact / gap token-DOM / delta gate 应保持兼容。
- **影响分析**：影响后续 AI Design Workflow 的实施优先级和对外叙述；核心变化是从“ADW fallback MVP”转为“Agent 主控 + ADW 底座，并清洗错误替代实现”。
