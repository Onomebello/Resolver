import { Octokit } from "@octokit/rest";
import { config } from "./config.js";
import type { IssueContext, RepoRef } from "./types.js";

export const octokit = new Octokit({ auth: config.githubToken });

export async function fetchIssue(repo: RepoRef, issueNumber: number): Promise<IssueContext> {
  const { data } = await octokit.issues.get({
    owner: repo.owner,
    repo: repo.repo,
    issue_number: issueNumber,
  });
  return {
    owner: repo.owner,
    repo: repo.repo,
    issueNumber,
    title: data.title,
    body: data.body ?? "",
  };
}

export async function commentOnIssue(repo: RepoRef, issueNumber: number, body: string): Promise<void> {
  await octokit.issues.createComment({
    owner: repo.owner,
    repo: repo.repo,
    issue_number: issueNumber,
    body,
  });
}

export async function removeLabel(repo: RepoRef, issueNumber: number, label: string): Promise<void> {
  try {
    await octokit.issues.removeLabel({
      owner: repo.owner,
      repo: repo.repo,
      issue_number: issueNumber,
      name: label,
    });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status !== 404) throw err;
  }
}

export async function getDefaultBranch(repo: RepoRef): Promise<string> {
  const { data } = await octokit.repos.get({ owner: repo.owner, repo: repo.repo });
  return data.default_branch;
}

export interface OpenPullRequestArgs {
  repo: RepoRef;
  head: string;
  base: string;
  issueNumber: number;
  title: string;
  summary: string;
  testOutput: string;
}

export async function openPullRequest(args: OpenPullRequestArgs): Promise<string> {
  const body = [
    `Fixes #${args.issueNumber}`,
    "",
    "## Summary",
    args.summary,
    "",
    "## Test confirmation",
    "```",
    args.testOutput.slice(0, 4000),
    "```",
    "",
    "_This pull request was created automatically by the Resolver agent._",
  ].join("\n");

  const { data } = await octokit.pulls.create({
    owner: args.repo.owner,
    repo: args.repo.repo,
    title: args.title,
    head: args.head,
    base: args.base,
    body,
  });
  return data.html_url;
}
