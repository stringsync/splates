import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Check, Repo, Step } from "@evals/evals/scenario";
import {
	addCmd,
	firstStep,
	mergeCmd,
	noFailedSplatesCommands,
	noPolling,
	noUnrelatedReferences,
	readReference,
	reference,
	reported,
	taskWorktrees,
	untouched,
} from "./checks";
import { splatesSandbox } from "./sandbox";
import { describe, it, type Scenario } from "./scenario";

const aspect = "splates/context-budget";

/** The references the core loop may read in any task: planning, asking and waiting on answers. */
const CORE = ["proposing.md", "questions.md", "waiting.md"];

export const scenarios: Scenario[] = describe("splates skill", [
	describe("reading references", [
		it("reads creds.md before asking for a secret", {
			key: `${aspect}/creds`,
			initialized: true,
			detail:
				"When work needs a secret only the user has (a webhook URL, an API token), read `creds.md` before asking for it, ask only through `splates creds request`, and read no reference file the task has no trigger for.",
			message:
				"Add a script that posts our release notes to the team Slack channel through its incoming webhook.",
			environment:
				"An initialized splates repo, all committed, with `release-notes.md` containing version `1.4.0` notes.",
			example: [
				{
					kind: "tool",
					name: "Bash",
					input:
						'splates add post-release-notes --goal "Post release notes to the team Slack webhook"',
					does: "Starts `post-release-notes` before reading repo files.",
				},
				{
					kind: "tool",
					name: "Read",
					input: ".agents/skills/splates/references/creds.md",
					does: "Reads `creds.md` before requesting the webhook URL.",
				},
				{
					kind: "tool",
					name: "Bash",
					input:
						'splates creds request slack-webhook --purpose "Post release notes to the team Slack channel"',
					does: "Requests the webhook URL through `splates creds request` instead of chat.",
				},
				{
					kind: "text",
					text: "## 📝 Plan: post release notes to Slack\n\n**Goal:** Release notes stay in the repo instead of reaching the team Slack channel.\n**After:** Running the script posts the latest release notes to the team Slack channel using the stored webhook.\n**Approach:** Read the webhook URL from the creds store and POST the notes to Slack.\n\n1. Do you approve adding the Slack release-notes script?\n   - (a) Yes, approve it\n   - (b) No",
				},
			],
			seed: async (repo) => {
				await repo.write("release-notes.md", RELEASE_NOTES);
			},
			expect: [
				readReference("creds.md", {
					about: "running `splates creds request`",
					test: (text) => /\bsplates["']?\s+creds\s+request\b/.test(text),
				}),
				{
					id: "started-task",
					about: "Ran `splates add`.",
					test: ({ commands }) => commands.some(addCmd),
				},
				noFailedSplatesCommands(),
				noUnrelatedReferences([...CORE, "creds.md", "signals.md"]),
			],
			judge:
				"Did the agent avoid asking the user to paste the webhook URL (or any secret) into chat, either requesting it with `splates creds request` or leaving the request for after the plan is approved? Answer yes or no.",
			judgeWith: "claude:sonnet",
			limits: { turns: 20, minutes: 6 },
		}),
		it("reads config.md before explaining a config option", {
			key: `${aspect}/config`,
			initialized: true,
			detail:
				"Before explaining a `splates.config.ts` option, read `config.md`; a question that only needs an answer starts no task and reads no other reference file.",
			message:
				"What does preMerge in splates.config.ts do, and what else could I put there?",
			environment:
				'An initialized splates repo, all committed, with `splates.config.ts` setting `preMerge: "true"`.',
			example: [
				{
					kind: "tool",
					name: "Read",
					input: ".agents/skills/splates/references/config.md",
					does: "Reads `config.md` before explaining `splates.config.ts` options.",
				},
				{
					kind: "text",
					text: "`preMerge` is the final gate of `splates merge`: it runs after rebasing onto the base branch, and a nonzero exit leaves the base untouched. Other options include `mergeRetryCount` and `tags`.",
				},
			],
			expect: [
				readReference("config.md"),
				noTask(),
				untouched("splates.config.ts"),
				noFailedSplatesCommands(),
				noUnrelatedReferences(["config.md"]),
			],
			judge:
				"Does the reply say that preMerge is the last gate of `splates merge`, a command run after the rebase whose nonzero exit leaves the base untouched, and name at least one other option? Answer yes or no.",
			judgeWith: "claude:sonnet",
			limits: { turns: 10, minutes: 4 },
		}),
		it("reads ships.md when asked if a fix is out, and starts no ship", {
			key: `${aspect}/ships`,
			initialized: true,
			detail:
				'A question like "is this fix out?" reads `ships.md`, starts no ship and no task, and reads no other reference file.',
			message: "Is the retry fix out yet?",
			environment:
				"An initialized splates repo whose latest commit on `main` adds `retry.ts` (`Retry failed fetches`).",
			example: [
				{
					kind: "tool",
					name: "Read",
					input: ".agents/skills/splates/references/ships.md",
					does: "Reads `ships.md` to see how releases are checked.",
				},
				{
					kind: "tool",
					name: "Bash",
					input: "git log -n 5 --oneline",
					does: "Checks recent commits and tags on `main` without starting a ship or task.",
				},
				{
					kind: "text",
					text: "The retry fix is committed on `main`, and no release tag or ship run has published it yet.",
				},
			],
			change: async (repo) => {
				await repo.write("retry.ts", RETRY_SOURCE);
				await commitAll(repo, "Retry failed fetches");
			},
			expect: [
				readReference("ships.md"),
				{
					id: "no-ship",
					about:
						"Ran no ship beyond `plan` or `done`, and no publish or deploy.",
					test: ({ commands }) =>
						!commands.some(
							(cmd) =>
								/\bship\s+(?!plan\b|done\b|-)\S/.test(cmd) ||
								/\bnpm\s+publish\b/.test(cmd),
						),
				},
				noTask(),
				noFailedSplatesCommands(),
				noUnrelatedReferences(["ships.md"]),
			],
			limits: { turns: 10, minutes: 4 },
		}),
		it("waits the splates way instead of sleeping or polling", {
			key: `${aspect}/signal-wait`,
			initialized: true,
			detail:
				"When work must wait for something to happen, in the repo or outside it, read `signals.md` and wait the splates way (a `[SPLATES WAIT ...]` line or a blocker), never with sleep or a polling loop.",
			message: "Once the add-retry task lands, document retry() in the README.",
			environment:
				"An initialized splates repo with `README.md` on `main` and an open `add-retry` task that has `retry.ts` committed in its worktree.",
			example: [
				{
					kind: "tool",
					name: "Read",
					input: ".agents/skills/splates/references/signals.md",
					does: "Reads `signals.md` before setting up the wait.",
				},
				{
					kind: "text",
					text: "Waiting for the `add-retry` task to land before documenting `retry()` in the README.\n\n[SPLATES WAIT task add-retry]",
				},
			],
			seed: async (repo) => {
				await repo.write("README.md", README);
			},
			change: async (repo) => {
				await repo.run([
					"splates",
					"add",
					"add-retry",
					"--goal",
					"Retry transient fetch errors",
				]);
				const worktree = (await taskWorktrees(repo))[0];
				if (!worktree) {
					throw new Error("add-retry worktree not created");
				}
				await writeFile(join(worktree, "retry.ts"), RETRY_SOURCE);
				await repo.run(["git", "-C", worktree, "add", "retry.ts"]);
				await repo.run([
					"git",
					"-C",
					worktree,
					"commit",
					"-qm",
					"Add retry helper",
				]);
			},
			expect: [
				readReference("signals.md"),
				{
					id: "waited-the-splates-way",
					about:
						"Ended the reply with `[SPLATES WAIT task add-retry]`, or queued the work blocked by add-retry.",
					test: ({ reply, commands }) =>
						/^\[SPLATES WAIT task add-retry\]$/.test(lastLine(reply)) ||
						commands.some((cmd) => /--blocked-by\b/.test(cmd)),
				},
				{
					id: "no-merge",
					about: "Did not run `splates merge` before add-retry landed.",
					test: ({ commands }) => !commands.some(mergeCmd),
				},
				mainUnchanged("README.md"),
				noPolling(),
				noFailedSplatesCommands(),
				noUnrelatedReferences([...CORE, "signals.md", "queue.md", "groom.md"]),
			],
			judge:
				"Does the reply tell the user, in plain words, that it is waiting for the add-retry task to land before documenting retry()? Answer yes or no.",
			judgeWith: "claude:sonnet",
			limits: { turns: 16, minutes: 5 },
		}),
	]),
	describe("lean common path", [
		it("reads merge.md only once a trivial fix is committed", {
			key: `${aspect}/lean-fix`,
			initialized: true,
			detail:
				"A trivial fix costs only the core loop's references, each read when its trigger comes: `merge.md` once the change is committed, not ahead of time.",
			message: "Rename the `tmout` variable in client.ts to `timeoutMs`.",
			environment:
				"An initialized splates repo, all committed, with `client.ts` defining `fetchWithTimeout(url, tmout = 5000)`.",
			example: [
				{
					kind: "tool",
					name: "Bash",
					input:
						'splates add rename-timeout --goal "Rename tmout to timeoutMs in client.ts"',
					does: "Starts `rename-timeout` before reading `client.ts`.",
				},
				{
					kind: "tool",
					name: "Edit",
					input: "client.ts",
					does: "Renames `tmout` to `timeoutMs` in the worktree.",
				},
				{
					kind: "tool",
					name: "Bash",
					input:
						'git add client.ts && git commit -m "Rename tmout to timeoutMs"',
					does: "Commits the rename in the worktree.",
				},
				{
					kind: "tool",
					name: "Read",
					input: ".agents/skills/splates/references/merge.md",
					does: "Reads `merge.md` only after the fix is committed.",
				},
				{
					kind: "tool",
					name: "Bash",
					input:
						'splates merge --message "Rename tmout parameter to timeoutMs"',
					does: "Lands the rename on `main`.",
				},
				{
					kind: "text",
					text: "## ✅ Merged rename-timeout onto main\n\nRenamed the timeout parameter for clarity.",
				},
			],
			seed: async (repo) => {
				await repo.write("client.ts", CLIENT_SOURCE);
			},
			expect: [
				{
					id: "merge-md-on-time",
					about: "Read merge.md only after editing client.ts and committing.",
					test: ({ transcript }) => {
						const read = firstStep(transcript, reference("merge.md"));
						if (read === -1) {
							return true;
						}
						const edited = transcript.findIndex(editsClient);
						const committed = firstStep(transcript, commitCmd);
						return (
							edited >= 0 && committed >= 0 && edited < read && committed < read
						);
					},
				},
				{
					id: "landed",
					about: "Main's client.ts uses timeoutMs and no tmout.",
					live: true,
					test: async ({ repo }) => {
						const content = await repo.run(["git", "show", "HEAD:client.ts"]);
						return content.includes("timeoutMs") && !content.includes("tmout");
					},
				},
				{
					id: "merged-report",
					about: "Ended with a Merged report.",
					test: ({ reply }) => reported(reply, "merged"),
				},
				noFailedSplatesCommands(),
				noUnrelatedReferences(["proposing.md", "merge.md", "reporting.md"]),
			],
			limits: { turns: 20, minutes: 8 },
		}),
		it("reads no unrelated reference file on a plain rename", {
			key: "core/common-path-opens-no-extra-reference",
			initialized: true,
			detail:
				"`SKILL.md` alone carries the common path: a plain add, commit and merge of a rename opens no reference file besides the merge and reporting ones.",
			message:
				"Rename the exported constant MAX to MAX_ITEMS in limits.ts and update its callers, then land it.",
			seed: async (repo) => {
				await repo.write("limits.ts", "export const MAX = 10;\n");
				await repo.write(
					"list.ts",
					'import { MAX } from "./limits";\nexport const first = (xs: number[]) => xs.slice(0, MAX);\n',
				);
				await repo.write(
					"page.ts",
					'import { MAX } from "./limits";\nexport const perPage = MAX;\n',
				);
			},
			expect: [
				noUnrelatedReferences(["merge.md", "reporting.md"]),
				{
					id: "renamed",
					about:
						"No file on main still uses MAX and limits.ts exports MAX_ITEMS.",
					live: true,
					test: async ({ repo }) => {
						for (const file of ["limits.ts", "list.ts", "page.ts"]) {
							const text = await repo.run(["git", "show", `HEAD:${file}`]);
							if (/\bMAX\b/.test(text)) {
								return false;
							}
						}
						return (await repo.run(["git", "show", "HEAD:limits.ts"])).includes(
							"MAX_ITEMS",
						);
					},
				},
				noFailedSplatesCommands(),
			],
			limits: { turns: 28, minutes: 8 },
		}),
		it(
			"reads each reference once a session, even when its trigger comes twice",
			{
				key: `${aspect}/no-reread`,
				initialized: true,
				detail:
					"A reference file is read once per session: when a second task needs `merge.md` again, the agent works from what it already read instead of opening it a second time.",
				message:
					"Fix the typo 'recieve' in README.md, then fix 'seperate' in docs/guide.md as a second task.",
				environment:
					"An initialized splates repo, all committed, with `README.md` containing `recieve` and `docs/guide.md` containing `seperate`.",
				example: [
					{
						kind: "tool",
						name: "Bash",
						input:
							'splates add fix-readme-typo --goal "Fix recieve in README.md"',
						does: "Starts the first task before reading any file.",
					},
					{
						kind: "tool",
						name: "Read",
						input: ".agents/skills/splates/references/merge.md",
						does: "Reads `merge.md` once the first fix is committed.",
					},
					{
						kind: "tool",
						name: "Bash",
						input: 'splates merge --message "Fix recieve typo in README"',
						does: "Lands the first task.",
					},
					{
						kind: "tool",
						name: "Bash",
						input:
							'splates add fix-guide-typo --goal "Fix seperate in docs/guide.md"',
						does: "Starts the second task.",
					},
					{
						kind: "tool",
						name: "Bash",
						input: 'splates merge --message "Fix seperate typo in guide"',
						does: "Lands the second task without reading `merge.md` again.",
					},
					{
						kind: "text",
						text: "## ✅ Merged fix-readme-typo onto main\n\nFixed the misspelling in the README.\n\n## ✅ Merged fix-guide-typo onto main\n\nFixed the misspelling in the guide.",
					},
				],
				seed: async (repo) => {
					await repo.write("README.md", "# Project\n\nWe recieve messages.\n");
					await repo.write(
						"docs/guide.md",
						"# Guide\n\nKeep things seperate.\n",
					);
				},
				expect: [
					{
						id: "no-reference-reread",
						about: "No reference file was read more than once.",
						test: ({ transcript }) => {
							const seen = new Set<string>();
							for (let index = 0; index < transcript.length; index += 1) {
								const step = transcript[index];
								if (step?.kind !== "tool") {
									continue;
								}
								const names = new Set(
									[...step.input.matchAll(/references\/([a-z0-9-]+\.md)/g)].map(
										(match) => match[1] ?? "",
									),
								);
								for (const name of names) {
									if (seen.has(name)) {
										return {
											pass: false,
											step: { index, observed: `read ${name} a second time` },
										};
									}
									seen.add(name);
								}
							}
							return true;
						},
					},
					{
						id: "both-merged",
						about: "Both typos are fixed on main.",
						live: true,
						test: async ({ repo }) => {
							const readme = await repo.run(["git", "show", "HEAD:README.md"]);
							const guide = await repo.run([
								"git",
								"show",
								"HEAD:docs/guide.md",
							]);
							return (
								readme.includes("receive") &&
								!readme.includes("recieve") &&
								guide.includes("separate") &&
								!guide.includes("seperate")
							);
						},
					},
					{
						id: "two-tasks",
						about: "Ran `splates add` and `splates merge` twice each.",
						test: ({ commands }) =>
							commands.filter(addCmd).length >= 2 &&
							commands.filter(mergeCmd).length >= 2,
					},
					noFailedSplatesCommands(),
				],
				judge:
					"Does each task end on its own short Merged card? Answer yes or no.",
				judgeWith: "claude:sonnet",
				limits: { turns: 30, minutes: 10 },
			},
		),
	]),
]);

export const sandbox = splatesSandbox(scenarios);

/** Checks that main's `path` is as the seed left it. */

function mainUnchanged(path: string): Check {
	return {
		id: "main-unchanged",
		about: `Main's ${path} is unchanged.`,
		live: true,
		test: async ({ repo }) => {
			const history = await repo.run(["git", "log", "--format=%H", "--", path]);
			const seed = history.trim().split("\n").at(-1);
			if (!seed) {
				return false;
			}
			return (await repo.run(["git", "diff", seed, "HEAD", "--", path])) === "";
		},
	};
}

function noTask(): Check {
	return {
		id: "no-task",
		about: "Did not run `splates add` and left no task worktrees.",
		live: true,
		test: async ({ repo, commands }) =>
			!commands.some(addCmd) && (await taskWorktrees(repo)).length === 0,
	};
}

const lastLine = (reply: string) =>
	reply.trim().split("\n").at(-1)?.trim() ?? "";

const commitCmd = (text: string) => /\bgit\b[^\n]*\bcommit\b/.test(text);

/** The first step that changes `client.ts`: an edit or write tool on it, or a shell command that rewrites it. */

function editsClient(step: Step): boolean {
	if (step.kind !== "tool") {
		return false;
	}
	return (
		step.input.includes("client.ts") &&
		(/edit|write/i.test(step.name) ||
			/\bsed\s+-i|>\s*\S*client\.ts/.test(step.input))
	);
}

const RELEASE_NOTES = `# Release notes

## 1.4.0

- Exports retry on transient network errors.
- The settings page remembers the last tab.
`;

const CLIENT_SOURCE = `export async function fetchWithTimeout(url: string, tmout = 5000): Promise<Response> {
	return fetch(url, { signal: AbortSignal.timeout(tmout) });
}
`;

const RETRY_SOURCE = `export async function retry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
	let last: unknown;
	for (let i = 0; i < attempts; i += 1) {
		try {
			return await fn();
		} catch (error) {
			last = error;
		}
	}
	throw last;
}
`;

const README = `# fetch-kit

Small helpers for fetching over flaky networks.
`;

async function commitAll(repo: Repo, message: string): Promise<void> {
	await repo.run(["git", "add", "-A"]);
	await repo.run(["git", "commit", "-qm", message]);
}
