import { App } from "@octokit/app";
import { platformConfig } from "./config.js";

export const githubApp = new App({
  appId: platformConfig.githubAppId,
  privateKey: platformConfig.githubAppPrivateKey,
  oauth: {
    clientId: platformConfig.githubAppClientId,
    clientSecret: platformConfig.githubAppClientSecret,
  },
  webhooks: {
    secret: platformConfig.githubAppWebhookSecret,
  },
});

/** Mints a short-lived (~1h) raw token string for git clone/push inside a job container. */
export async function mintInstallationToken(installationId: number): Promise<string> {
  const auth = await githubApp.octokit.auth({
    type: "installation",
    installationId,
  });
  return (auth as { token: string }).token;
}
