# Forgeathon Project Guide

## Project status

This repository is our entry to the TrueFoundry Forge-a-thon at Techfest 2026-27: a VS Code
extension (working name Synapse) whose agent loop runs on TrueForge. The working slice is built, but
it has not yet been run against a live TrueForge or inside VS Code. See `docs/progress/README.md` for
what is verified and what is not, and keep that file honest.

The competition's requirements are recorded in `docs/competition/`, digested from the brief in that
folder. Do not assume requirements, product behavior, or team decisions that are not recorded in the
repository. Mark unresolved details as `TBD` and ask for confirmation before building around them.

## Competition rules that can disqualify us

Read `docs/competition/README.md` before changing anything these touch. The short version is in
`.claude/rules/eligibility.md`, and `tests/repo/compliance.test.ts` enforces what it can.

- The agent loop runs on TrueForge. The extension never calls a model provider directly.
- Editor capabilities reach the agent only as MCP tools, so the agent decides what to read and change.
- No model or provider is hard-coded. Definitions carry no model.
- No API key or secret is ever committed. `agent/models.example.json` is the example configuration.
- Everything is the team's own work, except declared forks and ordinary dependencies.

## Repository conventions

- Write code comments, documentation, issue content, and user-facing text in English.
- Keep each component within its documented responsibility:
  - `extension/` contains the VS Code extension. Logic in `extension/src/core` and
    `extension/src/mcp` must not import `vscode`, so it stays testable.
  - `agent/` contains the agent definitions, model configuration examples, and TrueForge scripts.
  - `tests/` contains tests and test guidance.
  - `examples/` contains minimal examples that can be followed or run.
- Keep architecture, decisions, research, and progress notes under their corresponding `docs/`
  directories.
- Prefer explicit interfaces and validation at component boundaries. Reject invalid input clearly
  rather than silently returning a success-shaped result.
- Keep dependencies minimal and never hard-code credentials or private data.
- Add accessible behavior as part of implementation, not as a later polish step.

## Making changes

- Read the relevant documentation before changing a component.
- Make focused changes and preserve existing behavior unless a change is intentional and documented.
- Add or update tests for behavior changes and report the checks that were run. `npm run check` runs
  them all; `npm run test:golden` also checks retrieval against the pinned Flask repository.
- A green test is not the goal. For retrieval especially, read the real output.
- Update setup instructions and decision records when implementation choices change.
- Do not fabricate competition requirements or cite uncited research as fact.
- Never add `Co-Authored-By` lines to commit messages.
- Never add "Generated with Claude Code" or any similar attribution to pull request descriptions.
