# Eligibility rules

Breaking one of these can disqualify the team, whatever else works. Source: the brief, digested in
`docs/competition/README.md`.

- The agent loop must run on TrueForge. Never call a model provider from the extension, and never add
  a provider SDK as a dependency.
- Editor capabilities (read, search, propose a write, run a command) must be MCP tools, so the agent
  decides what to read and change. The extension may assemble context but must not make those choices.
- Models are configured in TrueForge. Never hard-code a provider or model in code or definitions.
- Never commit an API key. Keys go in `.env`; `agent/models.example.json` ships instead.
- If upstream code is ever copied or forked, preserve its licence and attribution and declare the
  repository and exact commit in the README. A licence violation is an eligibility failure.
- Do not use code from an employer or a private codebase.

If a task seems to need one of these broken, stop and raise it with the team.
