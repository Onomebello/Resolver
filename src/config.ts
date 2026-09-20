import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value : fallback;
}

const [defaultOwner, defaultRepo] = optional("GITHUB_REPO", "").split("/");

export const config = {
  githubToken: required("GITHUB_TOKEN"),
  webhookSecret: required("WEBHOOK_SECRET"),
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
