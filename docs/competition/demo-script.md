# Demo script: four minutes

Requirements: at most 4 minutes, editor visible, Tasks A, B, C **in that order**, each followed by its
on-screen verification, TrueForge session shown briefly during Task B. Narration or captions are optional.

The brief says: "You may cut out model waiting time; do not cut between giving an instruction and the
diff appearing." Those two can pull against each other, so see the [open questions](#open-questions)
before editing the video.

## Plan

Timings are a starting point. Fill in the real timestamps for the write-up's scorecard.

| Target | Segment | Show | Criteria |
| --- | --- | --- | --- |
| 0:00 | Setup | Editor on Flask 3.1.3, panel open, `git status` clean | |
| 0:10 | **Task A** | Select `get_debug_flag`, `Ctrl+Alt+K`, paste the instruction, tokens stream, review editor opens, accept per hunk | A1, A3 |
| 0:50 | Verify A | `verify-a` prints `False` | C1 |
| 1:00 | **Undo** | Click Undo Last Change, file restored, `git status` clean | B2 |
| 1:10 | **Task B** | Paste the instruction with no files named. Pause on the context ledger: files and reasons | A2, B1 |
| 1:30 | Review | Hunks in three or more files. Accept most; rejecting one shows per-hunk control | A2, B2 |
| 2:10 | Verify B | `pytest tests/test_cli.py -q` passes, `flask --help` lists `config`, masked JSON, `git diff --stat` | C1 |
| 2:30 | Session | TrueForge Sessions view: turns, tool calls, subagent or deferred tools if used | B4 |
| 2:45 | Reset | Undo Last Run, `git status` clean, ready for Task C | B2 |
| 2:55 | **Task C** | Primary model broken. Repeat Task A. Editor stays responsive, notice says it switched | B3 |
| 3:25 | Verify C | Reject the diff, then `git status` shows nothing changed | B3 |
| 3:35 | **Cancel** | Start a run, press Stop mid-stream, status says restored, `git status` clean | A3 |
| 3:55 | End | | |

## Task C

Two things must both be true on screen, and they conflict if you are not careful:

- A second model takes over automatically, which is the 10-point anchor.
- `git status` shows no files changed.

So when the fallback model's diff appears, show it is working, then **reject it**. Accepting would change
the file and fail the verification. To set up:

```bash
npm run setup:models -- --config agent/models.task-c.example.json
```

Then put `"synapse.models": ["unreachable/primary", "<your real model>"]` in your settings. Replace the
scripted fallback in that file with the real model you declare in the write-up.

## Before recording

- [ ] Run the whole script once with the model you will declare
- [ ] Editor font and terminal zoomed so a judge can read them
- [ ] No API keys, tokens or private notifications on screen
- [ ] `npm run demo:flask -- reset` so the first frame is clean
- [ ] Check the checkout is really at `22d92470`
- [ ] Link is public: YouTube unlisted, or Drive "anyone with the link can view"
- [ ] Open the link in a private window before submitting

## After recording

- [ ] Note the timestamp of each criterion for the scorecard
- [ ] Re-watch at normal speed: can every outcome be read without pausing?

## Open questions

Ask these in the portal's **Doubt section**. Do not assume the answers.

1. "You may cut out model waiting time; do not cut between giving an instruction and the diff appearing."
   May we cut the time the model spends generating, as long as no cut hides what happened?
2. With automatic fallback, does Task C accept rejecting the fallback's diff so `git status` stays clean?
3. Is it acceptable to pin a TrueForge version rather than use `@latest`, for a reproducible demo?
4. May the video include a short cancel demonstration after Task C? Cancel is scored (A3) but is not part
   of a fixed task, and criterion C1 penalises tasks being out of order.
