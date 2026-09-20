// Builds the prompt file for the headless Claude Code run from environment
// variables (never from templated ${{ }} expressions inside a run: script),
// so untrusted issue content can't be interpreted as shell syntax.
import fs from "node:fs";

const { ISSUE_TITLE, ISSUE_BODY, ISSUE_NUMBER } = process.env;

const body = ISSUE_BODY && ISSUE_BODY.trim() ? ISSUE_BODY.trim() : "(no description provided)";

const prompt = `You are resolving a GitHub issue in the repository checked out at the current working directory.

Follow this procedure:
1. Search the codebase and read the relevant files to find the root cause of the issue below.
2. Write or update a test that reproduces the bug, if the repository has a test suite.
3. Apply the minimal code fix for the root cause.
4. Run \`npm test\` and iterate on the fix until it passes.
5. Once the tests pass, stop. Do not create git commits, branches, or pull requests yourself -
   that is handled by the surrounding automation. Just leave the working tree with your fix applied.

Issue #${ISSUE_NUMBER}: ${ISSUE_TITLE}

${body}
`;

fs.writeFileSync("/tmp/prompt.md", prompt);
