# The competition

A digest of the brief, [TrueFoundry_Forge-a-thon_compressed_UvvRJ9C.pdf](TrueFoundry_Forge-a-thon_compressed_UvvRJ9C.pdf).
If this page and the brief disagree, the brief wins. The latest information is on techfest.org.

- [scoring.md](scoring.md): the 100 points, and our plan for the top anchor of each
- [fixed-tasks.md](fixed-tasks.md): the three tasks, word for word
- [demo-script.md](demo-script.md): how to fit it all into four minutes
- [write-up-template.md](write-up-template.md): the required eight headings, and [a draft](write-up-draft.md) with the content filled in

## Key dates

| Event | Date |
| --- | --- |
| Registration closes | **15 November 2026** |
| Round 1 submission deadline | **20 November 2026, 23:59 IST** |
| Round 1 results | 30 November 2026 |
| Round 2 (finals at IIT Bombay) | 16 to 18 December 2026 |
| Social media links form | By 18 December 2026 |
| Prize money form | 31 December 2026 |

## What we must build

A coding agent as a VS Code extension whose agent loop runs on TrueForge. Given a real repository, it
reads the code, plans a change, edits several files, and presents those edits for review in the editor.

Five capabilities are mandatory:

1. **Inline edit.** Select code, press a keybinding, type an instruction, get a diff rendered in the
   editor to accept or reject. A chat reply to copy and paste does not count.
2. **Agent mode.** A panel where one request drives a TrueForge agent through a tool loop (read file,
   search, write file, run a terminal command) until done. It must change at least three files without
   the user naming them.
3. **Context assembly.** Explicit `@file` and `@symbol` mentions, plus automatic retrieval of relevant
   code the user did not mention. The brief calls this the intellectual core of the problem.
4. **Diff review.** Hunk by hunk with a visible preview, accepted or rejected individually. No silent
   writes to disk. An applied change must be undoable.
5. **Streaming and cancellation.** Tokens appear as they arrive through TrueForge's streaming events.
   The user can interrupt mid-flight, the editor never blocks, and a cancelled run leaves no half-applied
   edits.

**Out of scope, and not scored:** tab completion; training, fine-tuning or hosting our own model; a
hosted backend, database or deployed service beyond TrueForge in local mode; accounts or
authentication; publishing to the Marketplace.

## Eligibility gate: pass or fail, checked first

The agent loop must run on TrueForge. Concretely:

- The extension is a client of a TrueForge agent. It creates sessions and sends turns through the HTTP
  API or TypeScript SDK, and renders the streamed events.
- Editor capabilities are exposed as MCP tools, so the agent, not the extension, decides what to read
  and change.
- TrueForge runs in local mode on our own machine. Nothing needs deploying. The sandbox is optional.
- The model is configured in TrueForge as a catalog provider or OpenAI-compatible endpoint. **The
  extension must not call a model provider directly.**
- The video must briefly show the TrueForge session for Task B (turns and tool calls), and **the
  repository must contain the agent definition used.**

## Models

Any model is acceptable: a paid API, a free tier, a gateway, or a local model behind an OpenAI-compatible
endpoint. Points are for behaviour on screen, never for how clever the model's answers are.

- The extension must work with whatever model TrueForge is configured with. Organisers may have a
  shortlisted team repeat a task live with a model of their choice.
- The write-up must state every model used, where it ran, and roughly what it cost.
- Never commit an API key. Ship an example configuration file instead.

## Building on open source

Reusing open-source code for the editor side is encouraged. Keeping an upstream project's own agent
loop is an eligibility failure. A fork must declare the upstream URL and exact commit in the README,
preserve the licence (a violation is an eligibility failure), and describe what changed. Judges score
the delta, reading git history from the declared commit forward. See
[ADR 0001](../decisions/0001-start-from-scratch.md) for what we chose.

## Submission: three artefacts, all public at the deadline

Submitted as links through the Techfest Competition Portal. **Links that are not public at the deadline
are not scored, and they will not request access.**

| Artefact | Requirements |
| --- | --- |
| Demo video | At most 4 minutes. Editor visible. Tasks A, B, C in that order, each followed by its on-screen verification, with the TrueForge session shown briefly during Task B. YouTube unlisted, or Google Drive with "anyone with the link can view". |
| Write-up | PDF, 1 to 3 pages, the [eight headings](write-up-template.md) in order. |
| GitHub repository | Public. A README whose setup works from a clean clone, including how to start TrueForge and load the agent definition; the fork point if any; an example model configuration. Upstream licence preserved. No secrets. |

## How judging works

- Two judges score independently and the score is the mean. A spread over 15 points brings in a third.
- The **top 15 teams** go to Round 2. Ties break on section B, then section A, then **earlier submission
  time**, so do not leave it to the last minute.
- Before the shortlist is final, each team joins a **10-minute video call to walk through its code and
  repeat Task A live with a model the organisers choose.** A team that cannot explain its own submission
  is replaced. Everyone should be able to explain all of this code, including what an AI tool wrote.

## Team and rules

- Anyone 18 or over. Up to 5 members, who may mix colleges, organisations, students and professionals.
  A valid photo ID is required. Each person may join only one team.
- Register at techfest.org to get a Team ID.
- Any AI coding tool may be used, declared in the write-up. It costs no points.
- Do not use code from an employer or any private codebase.
- The submission must be public under an open-source licence compatible with any upstream. Submitting
  grants TrueFoundry and Techfest a non-exclusive, perpetual, royalty-free licence to use, modify and
  showcase it, and registration details are shared with TrueFoundry.
- Copying or sharing between teams disqualifies everyone involved.
- Questions go through the portal's **Doubt section**; email is not answered. TrueForge questions are
  best asked in the [community Discord](https://discord.com/invite/fHeGRvakb).

## Round 2

The 15 finalists go to IIT Bombay. It involves building agents on TrueForge and **raising a pull request
to the TrueForge repository**, reviewed as part of the score. TrueFoundry provides model credits. The
problem statement and criteria come before the finale. Expect to operate what you built in front of
judges, on material you have not seen, and to answer design questions.

## Prizes

| Award | Prize |
| --- | --- |
| 1st, 2nd, 3rd place | INR 1,00,000, 75,000, 50,000 |
| Social Media Award: first, two runners-up, five special mentions | INR 30,000, 10,000 each, 5,000 each |

Top performers are also considered for internship Pre-Placement Interviews at TrueFoundry.

**Social media contest (optional, separate from the technical score):** post on LinkedIn, X or YouTube
between 15 October and 18 December 2026, showing what we built and including the demo, with
`#TrueForge`, `#Forgeathon` and `#<YourTeamName>`. Score is LinkedIn reactions plus X impressions plus
YouTube views. Bought or bot engagement disqualifies. Links are submitted through a form TrueFoundry
shares by 18 December.

## Links from the brief

- TrueForge: [repository](https://github.com/truefoundry/trueforge), [docs](https://trueforge.dev),
  [quickstart](https://trueforge.dev/quickstart), [SDK](https://trueforge.dev/api/overview),
  [Discord](https://discord.com/invite/fHeGRvakb)
- [VS Code Extension API](https://code.visualstudio.com/api)
- Pinned repository: [pallets/flask](https://github.com/pallets/flask), tag 3.1.3
- Editor-side references: [Cline](https://github.com/cline/cline),
  [Continue](https://github.com/continuedev/continue), [Roo Code](https://github.com/RooCodeInc/Roo-Code),
  [opencode](https://github.com/sst/opencode). Their current state is in
  [our research notes](../research/upstream-editors.md).
- TrueFoundry: [site](https://www.truefoundry.com),
  [agent harness docs](https://www.truefoundry.com/docs/agent-platform/agent-harness/overview)
