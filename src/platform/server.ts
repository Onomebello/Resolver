import express from "express";
import { createNodeMiddleware } from "@octokit/webhooks";
import { platformConfig } from "./config.js";
import { githubApp } from "./githubApp.js";
import { authRouter } from "./auth.js";
import { apiRouter } from "./api.js";
import { attachSession } from "./session.js";
import { logger } from "../logger.js";
import "./webhook.js"; // registers githubApp.webhooks event handlers

const app = express();

// Mounted before any body parser: this middleware reads and verifies the raw webhook
// body itself and must see it unparsed.
app.use(createNodeMiddleware(githubApp.webhooks, { path: "/webhook" }));

app.use(express.json());
app.use(attachSession);
app.use(authRouter);
app.use(apiRouter);

app.get("/healthz", (_req, res) => res.status(200).send("ok"));

app.listen(platformConfig.port, () => {
  logger.info(`Resolver platform listening on port ${platformConfig.port}`);
});
