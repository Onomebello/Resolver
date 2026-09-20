import { optional, required } from "./env.js";

const [defaultOwner, defaultRepo] = optional("GITHUB_REPO", "").split("/");

export const config = {
  githubToken: required("GITHUB_TOKEN"),
  // Only required by the single-tenant webhook server (src/index.ts), which validates
  // this itself at startup; the run-once runner (src/run-once.ts) never needs it.
  webhookSecret: optional("WEBHOOK_SECRET", ""),
  anthropicApiKey: required("ANTHROPIC_API_KEY"),
  anthropicModel: optional("ANTHROPIC_MODEL", "claude-sonnet-5"),
  triggerLabel: optional("TRIGGER_LABEL", "ai-resolve"),
  port: Number(optional("PORT", "3000")),
  workspaceDir: optional("WORKSPACE_DIR", ".workspaces"),
  testCommand: optional("TEST_COMMAND", "npm test"),
  maxTestRetries: Number(optional("MAX_TEST_RETRIES", "4")),
  maxAgentTurns: Number(optional("MAX_AGENT_TURNS", "30")),
  defaultOwner: defaultOwner || undefined,
  defaultRepo: defaultRepo || undefined,
};
