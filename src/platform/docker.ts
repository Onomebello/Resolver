import { execFile } from "node:child_process";
import { platformConfig } from "./config.js";
import { logger } from "../logger.js";

export interface RunnerJob {
  githubToken: string;
  anthropicApiKey: string;
  repoOwner: string;
  repoName: string;
  issueNumber: number;
}

export interface RunnerJobResult {
  success: boolean;
  prUrl?: string;
  reason?: string;
}

/**
 * Runs one issue-resolution job in an ephemeral, resource-limited container. Uses
 * execFile with an argv array (never a shell string) so that secret values -- the
 * installation token and the tenant's own Anthropic key -- can never be interpreted as
 * shell syntax, however they're formatted.
 */
export async function runResolverJob(job: RunnerJob): Promise<RunnerJobResult> {
  const args = [
    "run",
    "--rm",
    "--memory=1g",
    "--cpus=1",
    "--pids-limit=512",
    "-e",
    `GITHUB_TOKEN=${job.githubToken}`,
    "-e",
    `ANTHROPIC_API_KEY=${job.anthropicApiKey}`,
    "-e",
    `GITHUB_REPO=${job.repoOwner}/${job.repoName}`,
    "-e",
    `ISSUE_NUMBER=${job.issueNumber}`,
    platformConfig.runnerImage,
  ];

  return new Promise((resolve) => {
    execFile(
      "docker",
      args,
      { timeout: platformConfig.runnerTimeoutMs, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const resultLine = stdout
          .split("\n")
          .reverse()
          .find((line) => line.startsWith("RESOLVER_RESULT="));

        if (resultLine) {
          try {
            const parsed = JSON.parse(resultLine.slice("RESOLVER_RESULT=".length)) as RunnerJobResult;
            resolve(parsed);
            return;
          } catch {
            // Fall through to the generic error path below.
          }
        }

        if (error) {
          logger.error("Runner container failed", { error: error.message, stderr: stderr.slice(-2000) });
          resolve({ success: false, reason: `Runner container failed: ${error.message}` });
          return;
        }

        resolve({ success: false, reason: "Runner container produced no result." });
      },
    );
  });
}
