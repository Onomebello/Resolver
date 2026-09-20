import crypto from "node:crypto";
import express, { type Request, type Response } from "express";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { processIssue } from "./orchestrator.js";
import type { IssuesLabeledPayload } from "./types.js";

interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
}

if (!config.webhookSecret) {
  throw new Error("Missing required environment variable: WEBHOOK_SECRET");
}

const app = express();

app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as RequestWithRawBody).rawBody = buf;
    },
  }),
);

function verifySignature(req: RequestWithRawBody): boolean {
  const signature = req.header("x-hub-signature-256");
  if (!signature || !req.rawBody) return false;

  const expected =
    "sha256=" + crypto.createHmac("sha256", config.webhookSecret).update(req.rawBody).digest("hex");

  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expectedBuf);
}

app.post("/webhook", (req: RequestWithRawBody, res: Response) => {
  if (!verifySignature(req)) {
    logger.warn("Rejected webhook with invalid signature");
    res.status(401).send("invalid signature");
    return;
  }

  const event = req.header("x-github-event");
  if (event !== "issues") {
    res.status(202).send("ignored");
    return;
  }

  const payload = req.body as IssuesLabeledPayload;

  if (payload.action !== "labeled" || payload.label?.name !== config.triggerLabel) {
    res.status(202).send("ignored");
    return;
  }

  const repo = { owner: payload.repository.owner.login, repo: payload.repository.name };
  const issueNumber = payload.issue.number;

  // Acknowledge immediately; GitHub expects a fast response and will retry on timeout.
  res.status(202).send("accepted");

  processIssue(repo, issueNumber).catch((err) => {
    logger.error("Unhandled error processing issue", {
      repo: `${repo.owner}/${repo.repo}`,
      issueNumber,
      error: (err as Error).message,
    });
  });
});

app.get("/healthz", (_req: Request, res: Response) => {
  res.status(200).send("ok");
});

app.listen(config.port, () => {
  logger.info(`Resolver webhook server listening on port ${config.port}`);
});
