# ADW Workflow

Use ADW as an agent-controlled design workflow substrate.

Rules:

- Do not edit `docs/design-<flow>.workflow.json` directly. Use `adw` commands.
- If `adw` is not available on PATH, run the same command as `npx -y github:dufemeng/ai-design-workflow <command> ...`.
- Start resumed work with `adw flow:status <target> <slug>`.
- Do not silently change root `DESIGN.md`; imports and deltas require explicit confirmation.
- Impeccable `/document`, `/critique`, `/polish`, `/audit`, and `/live` are agent skills, not ADW CLI commands.
- ADW detector results must come from `impeccable detect --json`.

Typical command flow:

```bash
adw flow:create <target> <slug> <title>
adw proposal:answer <target> <slug> <question> <answer> [--dimension ...]
adw proposal:generate <target> <slug> <directions.json>
adw proposal:approve <target> <slug> <selection>
adw design:flow-generate <target> <slug> <spec.json>
adw handoff:critique <target> <slug>
adw import:critique <target> <slug> <result.json>
adw design:review <target> <slug> [judgment.json]
adw design:approve <target> <slug>
adw code:target <target> <slug> <route-or-url> [--no-auth]
adw gap:run <target> <slug> <url> [--storage state.json]
adw live:record <target> <slug> <purpose> [flags]
adw flow:done <target> <slug> [--accept-warnings]
```

For `/document`, run `adw handoff:document`, execute the agent skill, then run `adw import:document`. This writes `DESIGN.md.draft` and a confirmation page; it does not overwrite root `DESIGN.md`.
