import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, Tool, ToolUseBlock } from "@anthropic-ai/sdk/resources/messages";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { WorkspaceTools } from "./tools.js";
import type { AgentRunResult, IssueContext } from "./types.js";

const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });

const TOOLS: Tool[] = [
  {
    name: "list_files",
    description:
      "List files and directories under a given path in the repository, recursively. " +
      "Ignores node_modules, .git, dist, build and coverage. Directories are suffixed with '/'.",
    input_schema: {
      type: "object",
      properties: {
        directory: {
          type: "string",
          description: "Directory to scan, relative to the repository root. Use '.' for the root.",
        },
      },
      required: ["directory"],
    },
  },
  {
    name: "read_file",
    description:
      "Read a chunk of a file, returned with 1-indexed line numbers. Omit start_line/end_line to read the whole file.",
    input_schema: {
      type: "object",
      properties: {
        filepath: { type: "string", description: "Path to the file, relative to the repository root." },
        start_line: { type: "integer", description: "First line to read (1-indexed, inclusive)." },
        end_line: { type: "integer", description: "Last line to read (1-indexed, inclusive)." },
      },
      required: ["filepath"],
    },
  },
  {
    name: "search_code",
    description:
      "Search the entire codebase for a regular expression pattern (symbols, function names, keywords). " +
      "Returns matching lines as 'path:line: content'.",
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regex or literal text to search for." },
      },
      required: ["pattern"],
    },
  },
  {
    name: "patch_file",
    description:
      "Deterministically apply a change to a file by replacing an exact, unique block of old_content with " +
      "new_content. old_content must match exactly one location in the file (read the file first to get the " +
      "exact current text). Use this for every code edit.",
    input_schema: {
      type: "object",
      properties: {
        filepath: { type: "string", description: "Path to the file, relative to the repository root." },
        old_content: { type: "string", description: "Exact existing text to replace. Must be unique in the file." },
        new_content: { type: "string", description: "Replacement text." },
      },
      required: ["filepath", "old_content", "new_content"],
    },
  },
  {
    name: "run_tests",
    description: "Run the test suite (or any shell command) in the repository and return stdout, stderr and exit code.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to run, e.g. 'npm test'." },
      },
      required: ["command"],
    },
  },
  {
    name: "finish",
    description:
      "Call this once the root cause is fixed and run_tests has passed. Ends the session and reports the outcome.",
    input_schema: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "Bulleted (markdown) summary of the root cause and the changes made, for the PR description.",
        },
        files_changed: {
          type: "array",
          items: { type: "string" },
          description: "List of file paths that were modified or added.",
        },
      },
      required: ["summary", "files_changed"],
    },
  },
];

function systemPrompt(issue: IssueContext): string {
  return [
    "You are an autonomous software engineering agent resolving a GitHub issue in the repository checked out at",
    "the workspace root. You have tools to explore, read, search, patch files and run the test suite.",
    "",
    "Follow this procedure strictly:",
    "1. Use search_code and read_file to locate the root cause of the issue. Do not guess.",
    "2. Write or update a test that reproduces the reported bug before fixing it, if the repo has a test suite.",
    "3. Use patch_file to apply the minimal code fix for the root cause.",
    "4. Call run_tests to execute the test suite. If tests fail, carefully read the stdout/stderr, form a new",
    "   hypothesis, and iterate. You have a limited number of run_tests attempts, so read failures carefully",
    "   before retrying rather than guessing repeatedly.",
    "5. Once run_tests passes, call the finish tool with a bulleted summary of the root cause and the changes",
    "   made, and the list of files you changed. Do not call finish before run_tests has passed.",
    "",
    "Rules:",
    "- Only use patch_file to change files; never ask the user to do something manually.",
    "- Keep changes minimal and focused on the root cause of this specific issue.",
    "- If, after your retries are exhausted, you cannot find a passing fix, call finish anyway with a summary",
    "  explaining what you tried and why it did not fully work.",
    "",
    `Issue #${issue.issueNumber}: ${issue.title}`,
    "",
    issue.body || "(no description provided)",
  ].join("\n");
}

interface FinishPayload {
  summary: string;
  files_changed: string[];
}

function isFinishPayload(value: unknown): value is FinishPayload {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.summary === "string" && Array.isArray(v.files_changed);
}

export async function runResolverAgent(issue: IssueContext, workspaceRoot: string): Promise<AgentRunResult> {
  const tools = new WorkspaceTools(workspaceRoot);
  const messages: MessageParam[] = [
    {
      role: "user",
      content: `Resolve issue #${issue.issueNumber}. Begin by exploring the repository structure.`,
    },
  ];

  let testFailureCount = 0;
  let lastTestPassed = false;
  let lastTestOutput = "";
  const filesChanged = new Set<string>();

  for (let turn = 0; turn < config.maxAgentTurns; turn++) {
    const response = await anthropic.messages.create({
      model: config.anthropicModel,
      max_tokens: 4096,
      system: systemPrompt(issue),
      tools: TOOLS,
      messages,
    });

    messages.push({ role: "assistant", content: response.content });

    const toolUses = response.content.filter((block): block is ToolUseBlock => block.type === "tool_use");

    if (toolUses.length === 0) {
      if (response.stop_reason === "end_turn") {
        messages.push({
          role: "user",
          content:
            "Continue working towards a fix. Use your tools, and call finish once run_tests has passed.",
        });
        continue;
      }
      break;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    let finished: FinishPayload | undefined;

    for (const toolUse of toolUses) {
      const input = toolUse.input as Record<string, unknown>;
      switch (toolUse.name) {
        case "list_files": {
          const result = await tools.listFiles(String(input.directory ?? "."));
          toolResults.push(toResultBlock(toolUse.id, result.output, !result.ok));
          break;
        }
        case "read_file": {
          const result = await tools.readFile(
            String(input.filepath ?? ""),
            typeof input.start_line === "number" ? input.start_line : undefined,
            typeof input.end_line === "number" ? input.end_line : undefined,
          );
          toolResults.push(toResultBlock(toolUse.id, result.output, !result.ok));
          break;
        }
        case "search_code": {
          const result = await tools.searchCode(String(input.pattern ?? ""));
          toolResults.push(toResultBlock(toolUse.id, result.output, !result.ok));
          break;
        }
        case "patch_file": {
          const filepath = String(input.filepath ?? "");
          const result = await tools.patchFile(
            filepath,
            String(input.old_content ?? ""),
            String(input.new_content ?? ""),
          );
          if (result.ok) filesChanged.add(filepath);
          toolResults.push(toResultBlock(toolUse.id, result.output, !result.ok));
          break;
        }
        case "run_tests": {
          if (testFailureCount >= config.maxTestRetries) {
            toolResults.push(
              toResultBlock(
                toolUse.id,
                `Retry budget exhausted (${config.maxTestRetries} failed attempts). Call finish now with your best summary.`,
                true,
              ),
            );
            break;
          }
          const result = await tools.runTests(String(input.command ?? config.testCommand));
          lastTestPassed = result.success;
          lastTestOutput = `exit code: ${result.exitCode}\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`;
          if (!result.success) testFailureCount++;
          logger.info("run_tests", { issue: issue.issueNumber, success: result.success, testFailureCount });
          toolResults.push(toResultBlock(toolUse.id, truncate(lastTestOutput, 8000), !result.success));
          break;
        }
        case "finish": {
          if (isFinishPayload(input)) {
            if (!lastTestPassed && testFailureCount < config.maxTestRetries) {
              toolResults.push(
                toResultBlock(
                  toolUse.id,
                  "run_tests has not passed yet. Fix the failure and call run_tests again before finishing.",
                  true,
                ),
              );
              break;
            }
            finished = input;
            toolResults.push(toResultBlock(toolUse.id, "Acknowledged.", false));
          } else {
            toolResults.push(toResultBlock(toolUse.id, "Invalid finish payload.", true));
          }
          break;
        }
        default: {
          toolResults.push(toResultBlock(toolUse.id, `Unknown tool: ${toolUse.name}`, true));
        }
      }
    }

    messages.push({ role: "user", content: toolResults });

    if (finished) {
      for (const f of finished.files_changed) filesChanged.add(f);
      return {
        success: lastTestPassed && filesChanged.size > 0,
        summary: finished.summary,
        filesChanged: Array.from(filesChanged),
        testOutput: lastTestOutput,
        reason: lastTestPassed ? undefined : "Tests did not pass within the retry budget.",
      };
    }
  }

  return {
    success: false,
    summary: "The agent did not converge on a passing fix within the allotted turns.",
    filesChanged: Array.from(filesChanged),
    testOutput: lastTestOutput,
    reason: "Exhausted max agent turns without calling finish.",
  };
}

function toResultBlock(toolUseId: string, output: string, isError: boolean): Anthropic.ToolResultBlockParam {
  return {
    type: "tool_result",
    tool_use_id: toolUseId,
    content: truncate(output, 8000),
    is_error: isError,
  };
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n...(truncated)` : text;
}
