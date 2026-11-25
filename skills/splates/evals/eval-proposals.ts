import { splatesSandbox } from "./sandbox";
import { describe, it, type Scenario } from "./scenario";

const aspect = "splates";

export const scenarios: Scenario[] = describe("splates skill", [
	describe("proposing evals", [
		it("shows a proposed eval as one sentence, one good reply and a check", {
			key: `${aspect}/eval-block`,
			detail:
				"When asked whether to add an eval for a rule, put a fenced `eval` block under `Approve eval <id>?` with Approve, Edit and Drop choices. The block has `group` and `title` that join into one sentence (title continues the group, e.g. `The splates skill` + `skips the plan and says so for a trivial fix`), `you`, a good reply as `pass` / `pass tool` lines, `starts`, a `check` per code check and a `judge`. It draws no wrong reply: no `fail:` line, and what is wrong goes in a `check`.",
			message:
				"The splates skill says a trivial typo fix skips the Plan card and says so in one line. Propose an eval for that rule for me to approve. No task, no code.",
			environment:
				"A plain git repo (not initialized with splates) with `package.json` and `README.md` containing the typo `'teh'`.",
			example: [
				{
					kind: "tool",
					name: "Read",
					input: ".agents/skills/splates/references/questions.md",
					does: "Reads `questions.md` for the `eval` block format.",
				},
				{
					kind: "text",
					text: "1. Approve eval `core/trivial-skips-plan`?\n   ```eval\n   group: The splates skill\n   title: skips the plan and says so for a trivial fix\n   you: Fix the typo 'teh' in README.md.\n   pass: Small and easy to revert: building directly.\n   pass tool: Bash splates merge --message \"Fix typo in README\"\n   does: Lands the typo fix with `splates merge`.\n   starts: An initialized splates repo with `README.md` containing the typo `'teh'`.\n   check: No reply holds a Plan card.\n   judge: Does the agent say in one line that it skips a plan?\n   ```\n   - (a) Approve (chosen)\n   - (b) Edit\n   - (c) Drop",
				},
			],
			seed: async (repo) => {
				await repo.write(
					"package.json",
					'{\n\t"name": "docs",\n\t"type": "module"\n}\n',
				);
				await repo.write("README.md", "# Docs\n\nThis is teh intro.\n");
			},
			expect: [
				{
					id: "eval-block-shape",
					about:
						"The reply holds a fenced `eval` block with `group`, `title`, `you`, a `pass` line, `starts`, a `check` and a `judge`, and no `fail:` line.",
					test: ({ reply }) => {
						const match = /```eval\n([\s\S]*?)```/.exec(reply);
						if (!match) {
							return false;
						}
						const keys = (match[1] ?? "")
							.split("\n")
							.map((line) => /^([a-z ]+?):/.exec(line)?.[1]);
						const has = (key: string) => keys.includes(key);
						return (
							has("group") &&
							has("title") &&
							has("you") &&
							has("pass") &&
							has("starts") &&
							has("check") &&
							has("judge") &&
							!has("fail") &&
							!has("fail tool")
						);
					},
				},
				{
					id: "title-continues-group",
					about:
						"The `title` is a verb phrase that continues the `group` (it does not start with a capital letter or `The`/`A`).",
					test: ({ reply }) => {
						const title = /^title:\s*(.+)$/m.exec(reply)?.[1]?.trim();
						return !!title && /^[a-z]/.test(title);
					},
				},
				{
					id: "approve-edit-drop",
					about:
						"The block sits under `Approve eval <id>?` with Approve, Edit and Drop choices.",
					test: ({ reply }) =>
						/^1\.\s+Approve eval\b.*\?/m.test(reply) &&
						/\(a\)\s+Approve/.test(reply) &&
						/\(b\)\s+Edit/.test(reply) &&
						/\(c\)\s+Drop/.test(reply),
				},
			],
			judge:
				"Does the eval block read as one sentence when its group and title are joined, show a single good reply, and put what would be wrong in a check rather than drawing a failing reply? Answer yes or no.",
			judgeWith: "claude:sonnet",
			limits: { turns: 12, minutes: 5 },
		}),
		it("describes each proposed tool call in a plain-English does line", {
			key: `${aspect}/eval-does-line`,
			detail:
				"In a proposed `eval` block, each `pass tool: <Tool> <input>` line is followed right away by a `does: <plain-English sentence>` line saying what the call does, with `backticks` around code. A `does:` that only repeats the command, or a tool line with no `does:`, is wrong.",
			message:
				"The splates skill says a task lands with `splates merge --message` saying what the base gains. Propose an eval for that rule, with the merge call as part of the good reply, for me to approve. No task, no code.",
			environment:
				"A plain git repo (not initialized with splates) with `package.json` and `README.md`.",
			example: [
				{
					kind: "tool",
					name: "Read",
					input: ".agents/skills/splates/references/questions.md",
					does: "Reads `questions.md` for the `eval` block and `does:` line rules.",
				},
				{
					kind: "text",
					text: '1. Approve eval `landing/merge-message`?\n   ```eval\n   group: The splates skill\n   title: lands a task with a merge message saying what the base gains\n   you: Land the README update in this worktree.\n   pass tool: Bash splates merge --message "Add intro section to README"\n   does: Lands the worktree on `main` with a message describing what the base gains.\n   pass: ## ✅ Merged readme-intro onto main\n   starts: An initialized splates repo with a committed README change in an open worktree.\n   check: Ran `splates merge` with `--message`.\n   judge: Does the `--message` describe what the base gains?\n   ```\n   - (a) Approve (chosen)\n   - (b) Edit\n   - (c) Drop',
				},
			],
			seed: async (repo) => {
				await repo.write(
					"package.json",
					'{\n\t"name": "docs",\n\t"type": "module"\n}\n',
				);
				await repo.write("README.md", "# Docs\n");
			},
			expect: [
				{
					id: "does-after-every-tool-line",
					about:
						"The `eval` block has at least one `pass tool:` line, and each is followed on the next line by a `does:` line.",
					test: ({ reply }) => {
						const block = /```eval\n([\s\S]*?)```/.exec(reply)?.[1];
						if (!block) {
							return false;
						}
						const lines = block.split("\n");
						const tools = lines.flatMap((line, i) =>
							line.startsWith("pass tool:") ? [i] : [],
						);
						return (
							tools.length > 0 &&
							tools.every((i) => (lines[i + 1] ?? "").startsWith("does:"))
						);
					},
				},
				{
					id: "does-is-not-the-command",
					about: "No `does:` line is just the tool call's own input repeated.",
					test: ({ reply }) => {
						const block = /```eval\n([\s\S]*?)```/.exec(reply)?.[1] ?? "";
						const lines = block.split("\n");
						return lines.every((line, i) => {
							if (!line.startsWith("pass tool:")) {
								return true;
							}
							const input = line
								.replace(/^pass tool:\s*\S+\s*/, "")
								.trim()
								.toLowerCase();
							const does = (lines[i + 1] ?? "")
								.replace(/^does:\s*/, "")
								.replace(/`/g, "")
								.trim()
								.toLowerCase();
							return does !== "" && does !== input;
						});
					},
				},
			],
			judge:
				"Is each `does:` line a plain-English sentence saying what the tool call does (with `backticks` around code), rather than the raw command repeated? Answer yes or no.",
			judgeWith: "claude:sonnet",
			limits: { turns: 12, minutes: 5 },
		}),
	]),
]);

export const sandbox = splatesSandbox(scenarios);
