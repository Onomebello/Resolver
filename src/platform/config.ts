import { optional, required } from "../env.js";

export const platformConfig = {
  databaseUrl: required("DATABASE_URL"),
  githubAppId: required("GITHUB_APP_ID"),
  githubAppPrivateKey: required("GITHUB_APP_PRIVATE_KEY").replace(/\\n/g, "\n"),
  githubAppClientId: required("GITHUB_APP_CLIENT_ID"),
  githubAppClientSecret: required("GITHUB_APP_CLIENT_SECRET"),
  githubAppWebhookSecret: required("GITHUB_APP_WEBHOOK_SECRET"),
  // 32-byte AES-256 key, base64-encoded, e.g.: openssl rand -base64 32
  encryptionKey: required("ENCRYPTION_KEY"),
  sessionSecret: required("SESSION_SECRET"),
  appBaseUrl: required("APP_BASE_URL"),
  triggerLabel: optional("TRIGGER_LABEL", "ai-resolve"),
  runnerImage: optional("RUNNER_IMAGE", "resolver-runner:latest"),
  runnerTimeoutMs: Number(optional("RUNNER_TIMEOUT_MS", String(25 * 60 * 1000))),
  port: Number(optional("PLATFORM_PORT", "4000")),
};
