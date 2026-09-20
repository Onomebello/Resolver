import crypto from "node:crypto";
import { parseCookie, stringifySetCookie } from "cookie";
import { Router } from "express";
import { Octokit } from "@octokit/rest";
import { platformConfig } from "./config.js";
import { githubApp } from "./githubApp.js";
import { upsertInstallation, upsertUser } from "./db/client.js";
import { clearSessionCookie, createSessionCookie, requireAuth, type AuthenticatedRequest } from "./session.js";
import { logger } from "../logger.js";

const STATE_COOKIE = "resolver_oauth_state";
const isSecure = platformConfig.appBaseUrl.startsWith("https://");

export const authRouter = Router();

function setStateCookie(res: import("express").Response, state: string): void {
  res.setHeader(
    "Set-Cookie",
    stringifySetCookie({
      name: STATE_COOKIE,
      value: state,
      httpOnly: true,
      path: "/",
      maxAge: 600,
      sameSite: "lax",
      secure: isSecure,
    }),
  );
}

authRouter.get("/auth/login", (_req, res) => {
  const state = crypto.randomBytes(16).toString("hex");
  const { url } = githubApp.oauth.getWebFlowAuthorizationUrl({ state });
  setStateCookie(res, state);
  res.redirect(url);
});

// Requires the user to already be signed in via /auth/login first, so the install ->
// authorize -> callback round trip below is state-protected the same way login is,
// closing the login-CSRF gap that skipping the state check for organic installs (see
// the callback handler below) would otherwise leave on our own "Install" button.
authRouter.get("/install", requireAuth, async (_req: AuthenticatedRequest, res) => {
  const state = crypto.randomBytes(16).toString("hex");
  const url = await githubApp.getInstallationUrl({ state });
  setStateCookie(res, state);
  res.redirect(url);
});

authRouter.get("/auth/callback", async (req, res) => {
  const code = typeof req.query.code === "string" ? req.query.code : undefined;
  const state = typeof req.query.state === "string" ? req.query.state : undefined;
  // Present when the user arrived here via "Install app" with "request user
  // authorization during installation" enabled, letting us attribute the
  // installation to the signed-in platform user in this same round trip.
  const installationIdRaw = typeof req.query.installation_id === "string" ? req.query.installation_id : undefined;

  const cookies = parseCookie(req.headers.cookie ?? "");
  const expectedState = cookies[STATE_COOKIE];

  if (!code) {
    res.status(400).send("Missing OAuth code");
    return;
  }
  // A user who lands here via our own "Sign in" or "Install" links always carries a
  // matching state cookie we just set (checked below). A user who installs the app
  // directly from GitHub's Marketplace/App page (with "request user authorization
  // during installation" enabled) arrives here with no prior request from us at all,
  // so there's no cookie to compare against — that's expected, not tampering, as long
  // as an installation_id is present to explain how they got here.
  if (expectedState) {
    if (state !== expectedState) {
      res.status(400).send("Invalid or expired OAuth state");
      return;
    }
  } else if (!installationIdRaw) {
    res.status(400).send("Missing OAuth state (session expired — please try signing in again)");
    return;
  }

  try {
    const { authentication } = await githubApp.oauth.createToken({ code });
    const userOctokit = new Octokit({ auth: authentication.token });
    const { data: githubUser } = await userOctokit.users.getAuthenticated();

    const user = await upsertUser(githubUser.id, githubUser.login);

    if (installationIdRaw) {
      const installationId = Number(installationIdRaw);
      // Fetch the installation's account login for display purposes; this call is
      // authenticated as the App itself, independent of the user's own token.
      const { data: installation } = await githubApp.octokit.request("GET /app/installations/{installation_id}", {
        installation_id: installationId,
      });
      const accountLogin =
        installation.account && "login" in installation.account ? installation.account.login : githubUser.login;
      await upsertInstallation(installationId, user.id, accountLogin);
      logger.info("Linked installation to user", { installationId, userId: user.id });
    }

    res.setHeader("Set-Cookie", [
      stringifySetCookie({ name: STATE_COOKIE, value: "", httpOnly: true, path: "/", maxAge: 0 }),
      createSessionCookie({ userId: user.id }),
    ]);
    res.redirect(`${platformConfig.appBaseUrl}/dashboard`);
  } catch (err) {
    logger.error("OAuth callback failed", { error: (err as Error).message });
    res.status(500).send("Sign-in failed. Please try again.");
  }
});

authRouter.post("/auth/logout", (_req, res) => {
  res.setHeader("Set-Cookie", clearSessionCookie());
  res.status(204).end();
});
