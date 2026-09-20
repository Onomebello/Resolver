# Resolver

Autonomous GitHub Issue Solver agent. Listens for issues labeled `ai-resolve`, uses the
Anthropic Messages API with tool use to locate the root cause, write a reproduction test,
apply a fix, and iterate against the test suite, then opens a pull request that closes the
issue.

There are three independent ways to run this, for different situations:

1. **Single-tenant webhook server** (`src/index.ts`) — a personal access token, one webhook,
   acts on whichever repos that token can reach. Good for your own repos.
2. **GitHub Actions workflow** (`.github/workflows/ai-issue-resolver.yml`) — no server to
   host at all; runs inside the target repo's own CI.
3. **Multi-tenant platform** (`src/platform`) — a GitHub App other people install on their
   own repos, each bringing their own Anthropic API key. This is the one to use if you want
   to offer this as a service to other GitHub accounts.

## 1. Single-tenant webhook server

```bash
npm install
cp .env.example .env   # fill in GITHUB_TOKEN, WEBHOOK_SECRET, ANTHROPIC_API_KEY
npm run dev             # webhook server on $PORT (default 3000)
```

Point a GitHub webhook (content type `application/json`, secret matching `WEBHOOK_SECRET`,
subscribed to the `Issues` event) at `POST /webhook`.

## 2. GitHub Actions workflow

See `.github/workflows/ai-issue-resolver.yml`. Add the `ANTHROPIC_API_KEY` repository secret
and label an issue `ai-resolve` to trigger it.

## 3. Multi-tenant platform

Other GitHub users sign in, install your GitHub App on whichever of their own repos they
choose, paste in their own Anthropic API key, and labeling an issue `ai-resolve` in any of
those repos triggers a resolution run — using *their* key and a GitHub token scoped to only
what they installed the app on.

### One-time GitHub App setup (you do this manually in the GitHub UI)

1. Go to **Settings → Developer settings → GitHub Apps → New GitHub App** (under your
   account or an org).
2. **GitHub App name**: anything unique, e.g. `your-name-resolver`.
3. **Homepage URL**: your `APP_BASE_URL`.
4. **Callback URL**: `<APP_BASE_URL>/auth/callback`.
5. **Request user authorization (OAuth) during installation**: check this box — it's what
   lets a single install flow both authenticate the user and tell us which installation is
   theirs.
6. **Webhook**: Active, URL `<APP_BASE_URL>/webhook`, and set a secret — this becomes
   `GITHUB_APP_WEBHOOK_SECRET`.
7. **Permissions**: Repository permissions → Contents: Read & write, Issues: Read & write,
   Pull requests: Read & write, Metadata: Read-only.
8. **Subscribe to events**: Issues, Installation, Installation repositories.
9. **Where can this GitHub App be installed?**: Any account (or Only this account, if it's
   just for you and collaborators to start).
10. Create the app. From its settings page, note the **App ID** and **Client ID**, generate
    a **Client secret**, and click **Generate a private key** (downloads a `.pem` file).

### Local setup

```bash
docker compose up -d postgres
cp .env.example .env   # fill in every GITHUB_APP_* / DATABASE_URL / ENCRYPTION_KEY /
                        # SESSION_SECRET / APP_BASE_URL var — see the comments in
                        # .env.example for exactly what each one is and how to generate it
npm run platform:migrate
npm run docker:build:runner   # builds the resolver-runner image each job runs in
npm run platform:dev          # control plane on $PLATFORM_PORT (default 4000)
```

The control plane needs a Docker daemon reachable from wherever it runs (it shells out to
`docker run` per job) — running it directly on a host with Docker installed is the simplest
setup; if you containerize the control plane itself later, mount `/var/run/docker.sock` into
it.

If you're developing locally, GitHub needs a public URL to reach `APP_BASE_URL` — use
something like `ngrok http 4000` and set the App's webhook/callback URLs, and your
`APP_BASE_URL`, to that tunnel URL.

### Using it (what an end user does)

1. Visit `<APP_BASE_URL>/auth/login` → signs in with GitHub.
2. Visit `<APP_BASE_URL>/install` (or click the `installUrl` returned by `GET /api/me`) →
   picks which repos to install the app on.
3. `POST /api/anthropic-key` with `{"apiKey": "sk-ant-..."}` → stored encrypted
   (`ENCRYPTION_KEY`, AES-256-GCM), never returned back in plaintext.
4. Labels an issue `ai-resolve` in any repo they installed the app on. The control plane
   mints a short-lived installation token, launches one `resolver-runner` container with
   that token + their Anthropic key, and the container runs the same agent loop as the
   other two modes, commenting on and eventually opening a PR against their repo.
5. `GET /api/runs` shows their run history (status, PR link, error) from the `runs` table.

## Project layout

- `src/agent.ts`, `src/tools.ts`, `src/git.ts`, `src/github.ts`, `src/orchestrator.ts` —
  the resolver core, shared by all three modes. It reads everything (GitHub token,
  Anthropic key, target repo) from environment variables / `src/config.ts`, which is what
  lets the same code run as a long-lived webhook server, inside GitHub Actions, or as a
  one-shot process in an ephemeral per-job container.
- `src/index.ts` — single-tenant webhook server (mode 1).
- `src/run-once.ts` — one-shot entrypoint: resolves exactly one issue (`ISSUE_NUMBER` env)
  against `GITHUB_REPO`, then exits. Used inside the runner container (mode 3); could also
  be invoked directly for a one-off manual fix.
- `Dockerfile.runner` — builds the `resolver-runner` image `run-once.ts` runs in.
- `src/platform/` — the multi-tenant control plane (mode 3): GitHub App auth (`githubApp.ts`,
  `auth.ts`), the Postgres-backed data model (`db/`), API key encryption (`crypto.ts`),
  session cookies (`session.ts`), the dashboard API (`api.ts`), the App-level webhook +
  per-job Docker dispatch (`webhook.ts`, `docker.ts`), and `server.ts` wiring it together.

## Notes

- Each issue is resolved against a fresh clone under `WORKSPACE_DIR` (a persistent
  `.workspaces/<owner>-<repo>` directory in modes 1 and 2; an ephemeral container filesystem
  in mode 3), reset to the repo's default branch before every run.
- Dependencies are installed automatically before the agent starts, based on whichever
  manifest is present (`package-lock.json`/`package.json`, `requirements.txt`, `Cargo.toml`,
  `go.mod`) — see `installDependencies` in `src/tools.ts`. Extend it, and
  `Dockerfile.runner`'s base image, for other ecosystems.
- The agent gets up to `MAX_TEST_RETRIES` failed `run_tests` calls and `MAX_AGENT_TURNS`
  tool-call turns before the run is reported back to the issue as unresolved instead of
  opening a PR.
- In mode 3, each job runs in its own `--rm`, memory/CPU/pid-limited container so one
  tenant's repo (its install/test scripts) can't affect another tenant's job or the host.
  The Docker invocation always uses `execFile` with an argv array, never a shell string, so
  a decrypted API key or token can never be interpreted as shell syntax.
