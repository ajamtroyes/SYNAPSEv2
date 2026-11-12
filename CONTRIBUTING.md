# Contributing

Thank you for contributing to Forgeathon. Keep changes focused, documented, and easy for the team to
review.

## Before you start

- Check the existing issues and project documentation to avoid duplicating work.
- For a substantial change, open an issue or discuss the proposal with the team before implementation.
- Read `docs/competition/README.md`. Some rules can disqualify the team.
- Do not commit credentials, private user data, or other sensitive information.

## Development workflow

1. Create a focused branch from `main`.
2. Make the smallest complete change that addresses the issue.
3. Add or update tests when behavior changes.
4. Run the checks below and report their results.
5. Update documentation when setup, behavior, interfaces, or decisions change.
6. Open a pull request with a clear summary, context, and verification notes.

## Commands

Requires Node.js 22.14 or newer.

| Command | What it does |
| --- | --- |
| `npm ci` | Installs dependencies |
| `npm run check` | Type checks, runs the tests, and builds. Run this before opening a pull request |
| `npm run test:golden` | Also checks retrieval against the pinned Flask repository |
| `npm run watch` | Rebuilds the extension on change. Press F5 in VS Code to run it |
| `npm run trueforge` | Starts TrueForge locally, able to reach the extension |
| `npm run smoke` | Checks the behaviour we rely on against a running TrueForge, with no API key |
| `npm run test:e2e` | Runs the extension's code against a running TrueForge, with the scripted model |
| `npm run test:vscode` | Runs the extension inside a real VS Code against a running TrueForge |
| `npm run mock-model` | Starts a scripted model, for working on the editor side at no cost |
| `npm run demo:flask -- setup` | Prepares the pinned Flask checkout for the fixed tasks |

## Pull request expectations

- Explain what changed and why.
- Link the related issue or decision, when one exists.
- Say which scoring criterion the change affects, if any.
- Call out assumptions, limitations, and follow-up work.
- Include screenshots or short recordings for user-facing changes when useful.
- Keep user-facing text and project documentation in English.

## Attribution in git and GitHub

- Never add `Co-Authored-By` lines to commit messages.
- Never add "Generated with Claude Code", or any similar attribution, to pull request descriptions.

The competition still requires AI coding assistants to be declared in the write-up under "Tools
used", which costs no points. Judges read our git history from the fork point forward, so keep commit
messages meaningful.

## Documentation and accessibility

- Prefer concise, structured Markdown with descriptive headings and links.
- Cite external research and distinguish verified facts from assumptions.
- Consider keyboard use, screen readers, readable contrast, and clear language when designing
  user-facing experiences. Every panel and review action must work from the keyboard, and color must
  never be the only signal.
