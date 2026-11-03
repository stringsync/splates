import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { Repo } from "@evals/evals/scenario";
import { CHECKPOINT, RECONNECT, RESUME } from "@splates/server/plans";
import type { Scenario } from "../box";
import { firstStep, opens } from "./discovery";

const aspect = "continuity";
const task = "continuity";
const question = "Which output label should follow ready?";

const resumeNote =
	" Continue that step only, then stop before verification or landing.";

const between = `\n\nThis is a seeded between-turn continuation of task ${task}. Locate its worktree with splates path ${task}; its SPLATES.md holds the saved task context. No merge is in progress.`;

/** Whether `reply` is a single sentence on a single line. */
export function oneSentence(reply: string): boolean {
	const text = reply.trim();
	return (
		text !== "" &&
		!text.includes("\n") &&
		text.split(/[.!?]["'`)]*\s+(?=\S)/).length === 1
	);
}

const plan = (note: string) => `# ${task}

## Goal

Write result.txt with exactly ready followed by a newline.

## Next

- [x] Established the required output.
- [ ] Write result.txt.

  Paused before writing result.txt.${note}

## Blocked
`;

/** The Removed report's title for `name`, or null when the reply has none. */
export function removedReport(reply: string, name: string): string | null {
	const title = reply.split("\n").find((line) => /^## 🧹 Removed /.test(line));
	if (title === undefined) {
		return null;
	}
	return title.slice("## 🧹 Removed ".length).split(":")[0]?.trim() === name
		? title
		: null;
}

async function worktree(repo: Repo): Promise<string> {
	return (await repo.run(["splates", "path", task])).trim();
}

async function read(path: string): Promise<string | null> {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return null;
		}
		throw error;
	}
}

/** Adds the task and gives it the saved plan, with `extra` and the `result` file if any. */
async function seeded(
	repo: Repo,
	{
		extra = "",
		result,
		note = resumeNote,
	}: { extra?: string; result?: string; note?: string } = {},
): Promise<string> {
	await repo.run([
		"splates",
		"add",
		task,
		"--goal",
		"Write result.txt with ready",
	]);
	const path = await worktree(repo);
	await repo.write(
		relative(repo.dir, join(path, "SPLATES.md")),
		plan(note) + extra,
	);
	if (result !== undefined) {
		await repo.write(relative(repo.dir, join(path, "result.txt")), result);
	}
	return path;
}

/**
 * A lost connection cut the write of result.txt short, leaving part of it:
 * only a look at the file tells it apart from a write that finished or
 * never started.
 */
const reconnect: Scenario = {
	id: "continuity/reconnect",
	aspect,
	initialized: true,
	requirement:
		"After a lost connection, check what the last step left (git status, git log, the file) before repeating it, and repeat it only if it did not finish.",
	async change(repo) {
		await seeded(repo, { result: "rea" });
	},
	message: `${RECONNECT + between} The last step you ran before the connection dropped was writing result.txt. Stop after that step.`,
	checks: [
		{
			id: "recovered",
			about: "result.txt holds ready and a newline",
			test: async ({ repo }) =>
				(await read(join(await worktree(repo), "result.txt"))) === "ready\n",
		},
		{
			id: "looked-first",
			about:
				"ran git status or log, or read result.txt, in an earlier step than the one that writes it",
			test: ({ transcript }) => {
				const tools = transcript.filter((step) => step.kind === "tool");
				const touches = (step: (typeof tools)[number]) =>
					step.input.includes("result.txt");
				const writes = (step: (typeof tools)[number]) =>
					/edit|write|patch|replace/i.test(step.name)
						? touches(step)
						: />\s*\S*result\.txt|\btee\b[^|;&]*result\.txt/.test(step.input);
				const looks = (step: (typeof tools)[number]) =>
					/\bgit\s+(status|log)\b|\b(cat|head|od|xxd|hexdump|wc)\b[^|;&]*result\.txt/.test(
						step.input,
					) ||
					(/read|view|open|cat/i.test(step.name) &&
						!/edit|write|patch|replace/i.test(step.name) &&
						touches(step));
				const look = tools.findIndex(looks);
				const write = tools.findIndex(writes);
				return look !== -1 && (write === -1 || look < write);
			},
		},
		{
			id: "not-landed",
			about:
				"never ran `splates merge` nor a test, build or other verification",
			test: ({ commands }) =>
				!commands.some((command) =>
					/\bsplates\s+merge\b|\b(bun|npm|pnpm|yarn)\s+(run\s+)?(test|build|premerge|typecheck)\b|\bbin\/mono\s+(test|premerge|fix)\b/.test(
						command,
					),
				),
		},
	],
	// Graded by code alone: a judge failed runs its own reason passed.
};

export const scenarios: Scenario[] = [
	{
		id: "continuity/checkpoint",
		aspect,
		initialized: true,
		requirement:
			"On [SPLATES CHECKPOINT], bring SPLATES.md up to date, keep each open question under Blocked, start nothing new, and reply with one line.",
		async change(repo) {
			// No instruction to continue: a checkpoint stops the step as it is.
			await seeded(repo, { extra: `\nOpen question: ${question}\n`, note: "" });
		},
		message: `${CHECKPOINT}\n\nThis is a seeded stop of task ${task}, which is open. Locate its worktree with splates path ${task}; its SPLATES.md holds the saved task context. No merge is in progress.`,
		checks: [
			{
				id: "checkpoint-read",
				about: "opened references/checkpoint.md, which the skill points to",
				test: ({ transcript }) =>
					firstStep(transcript, opens("references/checkpoint.md")) !== -1,
			},
			{
				id: "output-untouched",
				about: "did not write result.txt",
				test: async ({ repo }) =>
					(await read(join(await worktree(repo), "result.txt"))) === null,
			},
			{
				// The seed already says where it stopped, so an unchanged
				// SPLATES.md is up to date.
				id: "plan-kept",
				about: "kept SPLATES.md's Next step and Blocked section",
				test: async ({ repo }) => {
					const notes = await read(join(await worktree(repo), "SPLATES.md"));
					return (
						(notes?.includes("Write result.txt") ?? false) &&
						(notes?.includes("## Blocked\n") ?? false)
					);
				},
			},
			{
				id: "question-kept",
				about: "kept the open question in SPLATES.md",
				// The question may be reformatted, as a checkbox or with its code
				// spans marked up, and still be kept.
				test: async ({ repo }) =>
					(await read(join(await worktree(repo), "SPLATES.md")))
						?.replaceAll("`", "")
						.includes(question) ?? false,
			},
			{
				id: "not-landed",
				about: "never ran `splates merge`",
				test: ({ commands }) =>
					!commands.some((command) => /\bsplates\s+merge\b/.test(command)),
			},
			{
				id: "one-sentence",
				about: "replied in one sentence",
				test: ({ reply }) => oneSentence(reply),
			},
		],
		// Graded by code alone: a judge failed runs its own reason passed.
	},
	{
		id: "continuity/resume",
		aspect,
		initialized: true,
		requirement:
			"On [SPLATES RESUME], read SPLATES.md again and carry on from the step it says was paused.",
		async change(repo) {
			await seeded(repo);
		},
		message: RESUME + between,
		checks: [
			{
				id: "continued",
				about: "wrote result.txt with ready and a newline",
				test: async ({ repo }) =>
					(await read(join(await worktree(repo), "result.txt"))) === "ready\n",
			},
			{
				id: "read-plan",
				about: "read SPLATES.md",
				test: ({ transcript }) =>
					transcript.some(
						(step) =>
							step.kind === "tool" &&
							(step.input.includes("SPLATES.md") ||
								step.output?.includes("Paused before writing") === true),
					),
			},
			{
				id: "not-landed",
				about:
					"never ran `splates merge` nor a test, build or other verification",
				test: ({ commands }) =>
					!commands.some((command) =>
						/\bsplates\s+merge\b|\b(bun|npm|pnpm|yarn)\s+(run\s+)?(test|build|premerge|typecheck)\b|\bbin\/mono\s+(test|premerge|fix)\b/.test(
							command,
						),
					),
			},
		],
		// Graded by code alone: a judge failed runs its own reason passed.
	},
	reconnect,
	{
		id: "continuity/removed-report",
		aspect,
		initialized: true,
		requirement:
			"A removed task ends with the Removed report: its title with the task and the reason, and a line on what it set out to do.",
		async change(repo) {
			await seeded(repo);
			await repo.run(["splates", "remove", task, "--reason", "moot"]);
		},
		message:
			"The continuity task was removed as moot. Report that outcome under the splates reporting rules; no further action is needed and there are no queued tasks.",
		checks: [
			{
				id: "removed-title",
				about: "the reply has a Removed report titled for the task",
				test: ({ reply }) => removedReport(reply, task) !== null,
			},
			{
				id: "no-question",
				about: "asked no question",
				test: ({ reply }) => !/^\s*1\. .*\?\s*$/m.test(reply),
			},
		],
	},
];
