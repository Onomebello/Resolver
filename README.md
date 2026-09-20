# Resolver

Autonomous GitHub Issue Solver agent. Listens for issues labeled `ai-resolve`, uses the
Anthropic Messages API with tool use to locate the root cause, write a reproduction test,
apply a fix, and iterate against the test suite, then opens a pull request that closes the
issue.

## Setup

```bash
npm install
cp .env.example .env   # fill in GITHUB_TOKEN, WEBHOOK_SECRET, ANTHROPIC_API_KEY
npm run dev             # webhook server on $PORT (default 3000)
```

Point a GitHub webhook (content type `application/json`, secret matching `WEBHOOK_SECRET`,
subscribed to the `Issues` event) at `POST /webhook`.

## Project layout

- `src/index.ts` — Express webhook server; verifies the `X-Hub-Signature-256` HMAC and
  filters for `issues.labeled` events on the trigger label.
- `src/orchestrator.ts` — end-to-end flow for one issue: comment, branch, run the agent,
  commit/push, open PR, remove label.
- `src/agent.ts` — the Anthropic tool-calling loop and system prompt.
- `src/tools.ts` — `list_files`, `read_file`, `search_code`, `patch_file`, `run_tests`
  implementations, sandboxed to the checked-out workspace.
- `src/github.ts` — Octokit helpers (issue fetch, comments, labels, pull requests).
- `src/git.ts` — local clone/branch/commit/push management via `simple-git`.
- `src/config.ts` — environment variable loading and validation.

## Notes

- Each issue is resolved against a persistent local clone under `WORKSPACE_DIR`
  (`.workspaces/<owner>-<repo>` by default), reset to the repo's default branch before every
  run.
- The agent gets up to `MAX_TEST_RETRIES` failed `run_tests` calls and `MAX_AGENT_TURNS` tool-call
  turns before the run is reported back to the issue as unresolved instead of opening a PR.
