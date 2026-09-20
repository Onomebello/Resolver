export interface RepoRef {
  owner: string;
  repo: string;
}

export interface IssueContext extends RepoRef {
  issueNumber: number;
  title: string;
  body: string;
}

/** Minimal shape of the subset of the GitHub `issues` webhook event we rely on. */
export interface IssuesLabeledPayload {
  action: string;
  issue: {
    number: number;
    title: string;
    body: string | null;
  };
  label?: {
    name: string;
  };
  repository: {
    name: string;
    owner: {
      login: string;
    };
  };
}

export interface ToolResult {
  ok: boolean;
  output: string;
}

export interface RunTestsResult {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface AgentRunResult {
  success: boolean;
  summary: string;
  filesChanged: string[];
  testOutput: string;
  reason?: string;
}
