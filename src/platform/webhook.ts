import { platformConfig } from "./config.js";
import { githubApp, mintInstallationToken } from "./githubApp.js";
import { createRun, deleteInstallation, finishRun, getAnthropicKey, getInstallation, markRunStarted } from "./db/client.js";
import { decryptSecret } from "./crypto.js";
import { runResolverJob } from "./docker.js";
import { logger } from "../logger.js";

githubApp.webhooks.on("issues.labeled", async ({ octokit, payload }) => {
  if (payload.label?.name !== platformConfig.triggerLabel) return;

  const installationId = payload.installation?.id;
  if (!installationId) return;

  const owner = payload.repository.owner.login;
  const repo = payload.repository.name;
  const issueNumber = payload.issue.number;

  const installation = await getInstallation(installationId);
  if (!installation) {
    logger.warn("Received event for an installation not linked to any user", { installationId });
    await octokit.request("POST /repos/{owner}/{repo}/issues/{issue_number}/comments", {
      owner,
      repo,
      issue_number: issueNumber,
      body: "🤖 This installation of the Resolver app isn't linked to an account yet. Sign in at the Resolver dashboard and complete the install flow from there, then re-apply this label.",
    });
    return;
  }

  const keyRow = await getAnthropicKey(installation.user_id);
  if (!keyRow) {
    await octokit.request("POST /repos/{owner}/{repo}/issues/{issue_number}/comments", {
      owner,
      repo,
      issue_number: issueNumber,
      body: "🤖 No Anthropic API key is on file for this account yet. Add one on the Resolver dashboard, then re-apply this label to try again.",
    });
    return;
  }

  const anthropicApiKey = decryptSecret({
    ciphertext: keyRow.encrypted_key,
    iv: keyRow.iv,
    authTag: keyRow.auth_tag,
  });

  const run = await createRun(installationId, owner, repo, issueNumber);
  logger.info("Queued resolver run", { runId: run.id, repo: `${owner}/${repo}`, issueNumber });

  // Webhook handlers must return quickly; the actual job runs in the background and
  // reports its outcome back onto the issue itself via the container's own comments.
  void dispatch(run.id, installationId, owner, repo, issueNumber, anthropicApiKey);
});

githubApp.webhooks.on("installation.deleted", async ({ payload }) => {
  await deleteInstallation(payload.installation.id);
  logger.info("Installation uninstalled; removed local record", { installationId: payload.installation.id });
});

async function dispatch(
  runId: string,
  installationId: number,
  owner: string,
  repo: string,
  issueNumber: number,
  anthropicApiKey: string,
): Promise<void> {
  try {
    await markRunStarted(runId);
    const githubToken = await mintInstallationToken(installationId);
    const result = await runResolverJob({
      githubToken,
      anthropicApiKey,
      repoOwner: owner,
      repoName: repo,
      issueNumber,
    });
    await finishRun(runId, {
      status: result.success ? "succeeded" : "failed",
      prUrl: result.prUrl,
      error: result.reason,
    });
  } catch (err) {
    const reason = (err as Error).message;
    logger.error("Resolver job dispatch failed", { runId, error: reason });
    await finishRun(runId, { status: "failed", error: reason });
  }
}
