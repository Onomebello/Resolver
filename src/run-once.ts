import { config } from "./config.js";
import { logger } from "./logger.js";
import { processIssue } from "./orchestrator.js";

/**
 * Entry point for the per-job runner container: resolves exactly one issue using the
 * credentials injected into this process's environment (a short-lived GitHub installation
 * token as GITHUB_TOKEN, and the owning user's own ANTHROPIC_API_KEY), then exits. Used by
 * the multi-tenant platform (src/platform) instead of the persistent webhook server.
 */
async function main(): Promise<void> {
  const issueNumberRaw = process.env.ISSUE_NUMBER;
  if (!issueNumberRaw) {
    throw new Error("ISSUE_NUMBER environment variable is required");
  }
  const issueNumber = Number(issueNumberRaw);
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    throw new Error(`Invalid ISSUE_NUMBER: ${issueNumberRaw}`);
  }
  if (!config.defaultOwner || !config.defaultRepo) {
    throw new Error("GITHUB_REPO environment variable (owner/repo) is required");
  }

  const result = await processIssue({ owner: config.defaultOwner, repo: config.defaultRepo }, issueNumber);

  // The control plane reads this exact line from the container's stdout to learn the
  // outcome, since it has no other channel back from an ephemeral, one-shot container.
  console.log(`RESOLVER_RESULT=${JSON.stringify(result)}`);
  process.exit(result.success ? 0 : 1);
}

main().catch((err) => {
  logger.error("run-once failed", { error: (err as Error).message });
  console.log(`RESOLVER_RESULT=${JSON.stringify({ success: false, reason: (err as Error).message })}`);
  process.exit(1);
});
