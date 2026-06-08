---
name: adw-workflow
description: Run an AI Design Workflow flow through Proposal, Design, and Code using ADW CLI as the deterministic substrate.
adwSkillVersion: 0.0.0
---

# ADW Workflow

Use this skill when a user wants to turn a one-line requirement, screenshot, HTML prototype, or existing page into a reviewed design artifact and implementation check.

## Hard Rules

- Never edit `docs/design-<flow>.workflow.json` by hand. Use `adw` commands only.
- If `adw` is not available on PATH, run the same command as `npx -y github:dufemeng/ai-design-workflow <command> ...`.
- Never silently change root `DESIGN.md`. Use `design:bootstrap` / `design:confirm`, `designmd:*`, or `import:document` followed by explicit confirmation.
- Do not claim ADW CLI runs Impeccable `/document`, `/critique`, `/polish`, `/audit`, or `/live`. Those are agent skills. ADW only creates handoff context and imports results.
- Detector findings must come from `impeccable detect --json` through ADW.
- Start each resumed turn with `adw flow:status <target> <slug>` and follow its resume pointer.

## Entry Points

One-line requirement:
1. `adw flow:create <target> <slug> <title>`
2. `adw scan <target>`
3. `adw design:bootstrap <target>` if root `DESIGN.md` is missing or stale.
4. Continue through Proposal.

Screenshot or HTML input:
1. Create the flow.
2. Capture assumptions in `proposal:answer`.
3. Generate a proposal workbench with 2-3 directions.

Existing page fix:
1. Create or resume the flow.
2. If no formal design artifact exists, generate one before Code.
3. Enter Code only after design review passes.

## Proposal

- Ask one high-leverage question at a time, with a recommended answer.
- Record answers with `adw proposal:answer <target> <slug> <question> <answer> [--dimension ...]`.
- Generate the HTML workbench with `adw proposal:generate <target> <slug> <directions.json>`.
- User decisions happen in conversation. Translate them into `adw proposal:approve <target> <slug> <selection>`.

## Design

- Generate formal artifacts with `adw design:flow-generate <target> <slug> <spec.json>`.
- The design spec must include machine-readable states. Each state or interaction needs either a runtime `driver` or an explicit `notTestableReason`; otherwise ADW writes artifacts but does not attach them to the flow ledger.
- If Impeccable `/document` is needed, run `adw handoff:document <target> <slug>`, execute `/document` in the agent harness, then import the result with `adw import:document <target> <slug> <result.json>`.
- If Impeccable `/critique` is needed, run `adw handoff:critique <target> <slug>`, execute `/critique`, then import with `adw import:critique <target> <slug> <result.json>`.
- Run `adw design:review <target> <slug> [judgment.json]`.
- Enter Code only with `adw design:approve <target> <slug>`.

## Code

- Set implementation target with `adw code:target <target> <slug> <route-or-url> [--no-auth]`.
- Run `adw gap:run <target> <slug> <url> [--storage state.json]`.
- Current gap checks include implementation health, DESIGN.md token drift, Impeccable detect, state/interaction runtime drivers, and `design-<flow>.html` semantic baseline diff. Visual/pixel diff is still evidence-only future enhancement.
- Use `adw gap:autofix-plan <target> <slug>` before deterministic auto-fix.
- Record manual or live changes with `adw live:record <target> <slug> <purpose> [flags]`.
- Finish with `adw flow:done <target> <slug> [--accept-warnings]`.

## Handoff Result Shapes

`import:document` expects:

```json
{
  "source": "agent-skill",
  "skill": "document",
  "agentHarness": "claude-code",
  "inputRefs": [],
  "outputRefs": [],
  "designVersion": null,
  "confirmedBy": "user",
  "designMdContent": "...complete DESIGN.md...",
  "sidecar": null,
  "tokensSummary": { "colors": {}, "typography": {} }
}
```

`import:critique` expects:

```json
{
  "source": "agent-skill",
  "skill": "critique",
  "agentHarness": "claude-code",
  "inputRefs": [],
  "outputRefs": [],
  "designVersion": "sha256:...",
  "confirmedBy": "user",
  "findings": []
}
```
