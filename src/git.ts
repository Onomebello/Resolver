import path from "node:path";
import { promises as fs } from "node:fs";
import { simpleGit, type SimpleGit } from "simple-git";
import { config } from "./config.js";
import { logger } from "./logger.js";
import type { RepoRef } from "./types.js";

function authenticatedRemoteUrl(repo: RepoRef): string {
  return `https://x-access-token:${config.githubToken}@github.com/${repo.owner}/${repo.repo}.git`;
}

function workspacePathFor(repo: RepoRef): string {
  return path.resolve(config.workspaceDir, `${repo.owner}-${repo.repo}`);
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensures a local, up-to-date clone of the repo exists and returns its absolute path.
 * Clones fresh on first use; otherwise fetches and hard-resets to the remote default branch
 * so every issue run starts from a clean, current tree.
 */
export async function ensureWorkspace(repo: RepoRef, defaultBranch: string): Promise<string> {
  const dir = workspacePathFor(repo);
  const remoteUrl = authenticatedRemoteUrl(repo);

  if (!(await pathExists(dir))) {
    await fs.mkdir(path.dirname(dir), { recursive: true });
    logger.info("Cloning repository", { repo: `${repo.owner}/${repo.repo}`, dir });
    const git = simpleGit();
    await git.clone(remoteUrl, dir);
  }

  const git: SimpleGit = simpleGit(dir);
  await git.removeRemote("origin").catch(() => undefined);
  await git.addRemote("origin", remoteUrl);
  await git.fetch("origin");
  await git.checkout(defaultBranch);
  await git.reset(["--hard", `origin/${defaultBranch}`]);
  await git.clean("f", ["-d"]);
  return dir;
}

export async function createIssueBranch(dir: string, branchName: string, baseBranch: string): Promise<void> {
  const git = simpleGit(dir);
  await git.checkout(baseBranch);
  await git.checkoutBranch(branchName, `origin/${baseBranch}`).catch(async () => {
    // Branch may already exist locally from a previous run; reset it to the base branch.
    await git.checkout(["-B", branchName, `origin/${baseBranch}`]);
  });
}

export async function hasChanges(dir: string): Promise<boolean> {
  const git = simpleGit(dir);
  const status = await git.status();
  return !status.isClean();
}

export async function commitAll(dir: string, message: string): Promise<void> {
  const git = simpleGit(dir);
  await git.add(["-A"]);
  await git.commit(message);
}

export async function pushBranch(dir: string, branchName: string, repo: RepoRef): Promise<void> {
  const git = simpleGit(dir);
  await git.push(authenticatedRemoteUrl(repo), branchName, ["--force", "--set-upstream"]);
}
