import { Router } from "express";
import {
  deleteAnthropicKey,
  getAnthropicKey,
  getUserById,
  listInstallationsForUser,
  listRunsForUser,
  setAnthropicKey,
} from "./db/client.js";
import { encryptSecret } from "./crypto.js";
import { requireAuth, type AuthenticatedRequest } from "./session.js";

export const apiRouter = Router();

apiRouter.get("/api/me", requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = await getUserById(req.userId!);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  const [installations, anthropicKey] = await Promise.all([
    listInstallationsForUser(user.id),
    getAnthropicKey(user.id),
  ]);
  res.json({
    githubLogin: user.github_login,
    hasAnthropicKey: Boolean(anthropicKey),
    installations: installations.map((i) => ({ id: i.id, accountLogin: i.account_login })),
    // A same-origin relative path the frontend can just link/redirect to; /install
    // itself mints a fresh CSRF state and redirects to GitHub.
    installUrl: "/install",
  });
});

apiRouter.post("/api/anthropic-key", requireAuth, async (req: AuthenticatedRequest, res) => {
  const apiKey = typeof req.body?.apiKey === "string" ? req.body.apiKey.trim() : "";
  if (!apiKey.startsWith("sk-ant-")) {
    res.status(400).json({ error: "That doesn't look like an Anthropic API key (expected it to start with sk-ant-)" });
    return;
  }
  const { ciphertext, iv, authTag } = encryptSecret(apiKey);
  await setAnthropicKey(req.userId!, ciphertext, iv, authTag);
  res.status(204).end();
});

apiRouter.delete("/api/anthropic-key", requireAuth, async (req: AuthenticatedRequest, res) => {
  await deleteAnthropicKey(req.userId!);
  res.status(204).end();
});

apiRouter.get("/api/runs", requireAuth, async (req: AuthenticatedRequest, res) => {
  const runs = await listRunsForUser(req.userId!);
  res.json(
    runs.map((r) => ({
      id: r.id,
      repo: `${r.repo_owner}/${r.repo_name}`,
      issueNumber: r.issue_number,
      status: r.status,
      prUrl: r.pr_url,
      error: r.error,
      createdAt: r.created_at,
      finishedAt: r.finished_at,
    })),
  );
});
