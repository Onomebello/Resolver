import { exec } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { ToolResult, RunTestsResult } from "./types.js";

const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", ".workspaces", "build", "coverage"]);
const MAX_SEARCH_RESULTS = 200;
const MAX_SEARCH_FILE_BYTES = 2 * 1024 * 1024;
const RUN_TESTS_TIMEOUT_MS = 5 * 60 * 1000;

/** Resolves a user-supplied relative path against the workspace root and rejects escapes. */
function resolveInWorkspace(workspaceRoot: string, relativePath: string): string {
  const resolved = path.resolve(workspaceRoot, relativePath);
  const normalizedRoot = path.resolve(workspaceRoot);
  if (resolved !== normalizedRoot && !resolved.startsWith(normalizedRoot + path.sep)) {
    throw new Error(`Path escapes workspace root: ${relativePath}`);
  }
  return resolved;
}

async function walk(dir: string, root: string, out: string[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(root, fullPath);
    if (entry.isDirectory()) {
      out.push(`${relativePath}/`);
      await walk(fullPath, root, out);
    } else if (entry.isFile()) {
      out.push(relativePath);
    }
  }
}

export class WorkspaceTools {
  constructor(private readonly workspaceRoot: string) {}

  async listFiles(directory: string): Promise<ToolResult> {
    try {
      const target = resolveInWorkspace(this.workspaceRoot, directory || ".");
      const stat = await fs.stat(target);
      if (!stat.isDirectory()) {
        return { ok: false, output: `Not a directory: ${directory}` };
      }
      const results: string[] = [];
      await walk(target, this.workspaceRoot, results);
      results.sort();
      return { ok: true, output: results.join("\n") || "(empty directory)" };
    } catch (err) {
      return { ok: false, output: `Error listing files: ${(err as Error).message}` };
    }
  }

  async readFile(filepath: string, startLine?: number, endLine?: number): Promise<ToolResult> {
    try {
      const target = resolveInWorkspace(this.workspaceRoot, filepath);
      const content = await fs.readFile(target, "utf8");
      const lines = content.split("\n");
      const start = Math.max(1, startLine ?? 1);
      const end = Math.min(lines.length, endLine ?? lines.length);
      if (start > end) {
        return { ok: false, output: `Invalid range: start_line (${start}) > end_line (${end})` };
      }
      const numbered = lines
        .slice(start - 1, end)
        .map((l, i) => `${start + i}\t${l}`)
        .join("\n");
      return { ok: true, output: numbered };
    } catch (err) {
      return { ok: false, output: `Error reading file: ${(err as Error).message}` };
    }
  }

  async searchCode(pattern: string): Promise<ToolResult> {
    try {
      if (!pattern || pattern.trim().length === 0) {
        return { ok: false, output: "Pattern must not be empty" };
      }
      let regex: RegExp;
      try {
        regex = new RegExp(pattern);
      } catch {
        regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      }
      const files: string[] = [];
      await walk(this.workspaceRoot, this.workspaceRoot, files);
      const matches: string[] = [];
      for (const relativePath of files) {
        if (relativePath.endsWith("/") || matches.length >= MAX_SEARCH_RESULTS) continue;
        const fullPath = path.join(this.workspaceRoot, relativePath);
        let stat;
        try {
          stat = await fs.stat(fullPath);
        } catch {
          continue;
        }
        if (!stat.isFile() || stat.size > MAX_SEARCH_FILE_BYTES) continue;
        let content: string;
        try {
          content = await fs.readFile(fullPath, "utf8");
        } catch {
          continue;
        }
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (matches.length >= MAX_SEARCH_RESULTS) break;
          if (regex.test(lines[i]!)) {
            matches.push(`${relativePath}:${i + 1}: ${lines[i]!.trim()}`);
          }
        }
      }
      if (matches.length === 0) {
        return { ok: true, output: "No matches found." };
      }
      const truncated = matches.length >= MAX_SEARCH_RESULTS ? "\n(results truncated)" : "";
      return { ok: true, output: matches.join("\n") + truncated };
    } catch (err) {
      return { ok: false, output: `Error searching code: ${(err as Error).message}` };
    }
  }

  async patchFile(filepath: string, oldContent: string, newContent: string): Promise<ToolResult> {
    try {
      const target = resolveInWorkspace(this.workspaceRoot, filepath);
      const current = await fs.readFile(target, "utf8");
      const occurrences = current.split(oldContent).length - 1;
      if (occurrences === 0) {
        return {
          ok: false,
          output: `old_content not found in ${filepath}. Re-read the file to get the exact current content before patching.`,
        };
      }
      if (occurrences > 1) {
        return {
          ok: false,
          output: `old_content matches ${occurrences} locations in ${filepath}. Include more surrounding context so the match is unique.`,
        };
      }
      const updated = current.replace(oldContent, newContent);
      await fs.writeFile(target, updated, "utf8");
      return { ok: true, output: `Patched ${filepath}` };
    } catch (err) {
      return { ok: false, output: `Error patching file: ${(err as Error).message}` };
    }
  }

  async runTests(command: string): Promise<RunTestsResult> {
    const cmd = command && command.trim().length > 0 ? command : "npm test";
    return new Promise((resolve) => {
      exec(
        cmd,
        { cwd: this.workspaceRoot, timeout: RUN_TESTS_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
        (error, stdout, stderr) => {
          const exitCode = error ? (typeof error.code === "number" ? error.code : 1) : 0;
          resolve({
            success: exitCode === 0,
            exitCode,
            stdout: stdout?.toString() ?? "",
            stderr: stderr?.toString() ?? "",
          });
        },
      );
    });
  }
}

const INSTALL_TIMEOUT_MS = 5 * 60 * 1000;

function runShell(cmd: string, cwd: string, timeoutMs: number): Promise<RunTestsResult> {
  return new Promise((resolve) => {
    exec(cmd, { cwd, timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      const exitCode = error ? (typeof error.code === "number" ? error.code : 1) : 0;
      resolve({
        success: exitCode === 0,
        exitCode,
        stdout: stdout?.toString() ?? "",
        stderr: stderr?.toString() ?? "",
      });
    });
  });
}

/**
 * Installs the target repo's dependencies before the agent starts, based on whichever
 * manifest is present. Without this, run_tests (and the agent's own fix) would fail on a
 * missing node_modules/vendor directory regardless of whether the fix itself is correct.
 */
export async function installDependencies(workspaceRoot: string): Promise<RunTestsResult> {
  const has = (name: string) =>
    fs
      .access(path.join(workspaceRoot, name))
      .then(() => true)
      .catch(() => false);

  let command: string | undefined;
  if (await has("package-lock.json")) command = "npm ci";
  else if (await has("package.json")) command = "npm install";
  else if (await has("requirements.txt")) command = "pip install -r requirements.txt";
  else if (await has("Cargo.toml")) command = "cargo fetch";
  else if (await has("go.mod")) command = "go mod download";

  if (!command) {
    return { success: true, exitCode: 0, stdout: "No recognized dependency manifest found; skipping install.", stderr: "" };
  }
  return runShell(command, workspaceRoot, INSTALL_TIMEOUT_MS);
}
