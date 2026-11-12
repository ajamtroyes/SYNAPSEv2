# Backlog

In priority order. Owners are TBD until the team is set, and it is worth moving these into GitHub issues with the
[Scored work](../../.github/ISSUE_TEMPLATE/scored_work.yml) template.

## P0: prove it works

- [ ] Run `npm run smoke -- --write` and fix whatever it finds. If the loopback or approval checks fail, stop and rethink before anything else
- [ ] Run the extension with F5 and `npm run mock-model`: panel loads, inline edit opens the review, Accept and Reject work per hunk, keyboard shortcuts work
- [ ] Run Task A with a real model
- [ ] Run Task B with a real model, and read the TrueForge session
- [ ] Confirm `classifyFailure` matches the real messages the smoke test records for a dead endpoint and a bad key
- [ ] Register the team by **15 November**

## P1: scored behaviour

- [ ] **A1, B2:** Decide if the merged review editor is good enough on video. If not, try rendering in the live document
- [ ] **A3:** Check the first token appears quickly during retrieval, and that Stop feels immediate on a slow model
- [ ] **B1:** Keep the ledger on screen during Task B, and check the agent really states its choices. Tune instructions if not
- [ ] **B1:** Try retrieval on another repository, to catch anything over-fitted to Flask
- [ ] **B3:** Time Task C. If TrueForge's own retries make failure slow, tune `MODEL_HTTP_MAX_RETRIES` or the attempts setting
- [ ] **B4:** Check subagents or deferred tools really appear in the session on Task B. If the model skips them, strengthen the instructions
- [ ] **Models:** Choose and declare them. Run the tasks on a free or local model too, since the organisers may pick a different one

## P2: robustness

- [ ] Weak models produce inexact `old_text`. Consider a whitespace-tolerant match, still requiring a unique result
- [ ] Multi-line decorators split from their function when chunking
- [ ] Companion matching can pull in fixtures such as `tests/static/config.json`
- [ ] Cache the retrieval index for large repositories
- [ ] Mixed line endings: VS Code normalises on edit, which can make undo report a false conflict
- [ ] Format-on-save can change reviewed content when an edit is saved
- [ ] Offer a way to keep already accepted hunks on cancel ([ADR 0004](../decisions/0004-cancel-rolls-back.md))
- [ ] Support several windows at once ([ADR 0002](../decisions/0002-loopback-mcp-server.md))
- [ ] Add Extension Host tests with `@vscode/test-electron`, as the editor layer has no automated tests
- [ ] A status line in the panel for the current model and cost per run (turn metrics include `total_cost_in_usd`), which also helps the write-up's cost figures

## Submission

- [ ] Record the video, following [the demo script](../competition/demo-script.md)
- [ ] Write-up, from [the template](../competition/write-up-template.md), including AI tools used
- [ ] Clean-clone test, then make the repository public
- [ ] Submit all three links through the portal

## Optional: social media contest

- [ ] Post on LinkedIn, X or YouTube with `#TrueForge`, `#Forgeathon` and `#<YourTeamName>`, between now and 18 December. Separate from the technical score, and no bought engagement

## Round 2 preparation

Only for the top 15, so after Round 1 unless time is spare. Finals are 16 to 18 December, and judges review a pull request to TrueForge.

- [ ] Read TrueForge's `CONTRIBUTING.md`. **Pull requests need a maintainer's approval on an issue first, so raise one early**
- [ ] Candidate: a model fallback chain in the harness, since we had to build one in the client ([ADR 0005](../decisions/0005-client-side-model-fallback.md)). Check for existing issues first
- [ ] Note any bugs the smoke test or real use uncovers: a small well-reported fix is a good contribution too
