import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import {
	CHECKPOINT,
	RECONNECT,
	RESUME,
} from "@stringsync/splates-server/plans";
import type { Repo, Scenario } from "../scenario";
import { firstStep, opens } from "./discovery";

const aspect = "continuity";
const task = "continuity";
const question = "Which output label should follow ready?";

const plan = `# ${task}

## Goal

Write result.txt with exactly ready followed by a newline.

## Next

- [x] Established the required output.
- [ ] Write result.txt.

  Paused before writing result.txt. Continue that step only, then stop before verification or landing.

## Blocked
`;

const between = `\n\nThis is a seeded between-turn continuation of task ${task}. Locate its worktree with splates path ${task}; its SPLATES.md holds the saved task context. No merge is in progress.`;

/** The Removed report's title for `name`, or null when the reply has none. */
export function removedReport(reply: string, name: string): string | null {
	const title = reply.split("\n").find((line) => /^## 🛑 Removed /.test(line));
	if (title === undefined) {
		return null;
	}
	return title.slice("## 🛑 Removed ".length).split(":")[0]?.trim() === name
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
	extra = "",
	result?: string,
): Promise<string> {
	await repo.run([
		"splates",
		"add",
		task,
		"--goal",
		"Write result.txt with ready",
	]);
	const path = await worktree(repo);
	await repo.write(relative(repo.dir, join(path, "SPLATES.md")), plan + extra);
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
		await seeded(repo, "", "rea");
	},
	message: `${RECONNECT + between} The last step you ran before the connection dropped was writing result.txt. Stop after that step.`,
	checks: [
		{
			id: "recovered",
			about: "result.txt holds ready and a newline",
			test: async ({ repo }) =>
				(await read(join(await worktree(repo), "result.txt"))) === "ready\n",
		},
	],
	judge:
		"Pass when the agent looked at what the interrupted step left (result.txt's partial content, git status or git log) before rewriting result.txt as ready and a newline, and stopped there. Fail when it wrote before looking, or went on to verify or land.",
};

export const scenarios: Scenario[] = [
	{
		id: "continuity/checkpoint",
		aspect,
		initialized: true,
		requirement:
			"On [SPLATES CHECKPOINT], bring SPLATES.md up to date, keep each open question under Blocked, start nothing new, and reply with one line.",
		async change(repo) {
			await seeded(repo, `\nOpen question: ${question}\n`);
		},
		message: CHECKPOINT + between,
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
				id: "plan-updated",
				about: "changed SPLATES.md and kept its Next and Blocked sections",
				test: async ({ repo }) => {
					const notes = await read(join(await worktree(repo), "SPLATES.md"));
					return (
						notes !== null &&
						notes !== plan &&
						["Next", "Blocked"].every((heading) =>
							notes.includes(`## ${heading}\n`),
						)
					);
				},
			},
			{
				id: "question-kept",
				about: "kept the open question in SPLATES.md",
				test: async ({ repo }) =>
					(await read(join(await worktree(repo), "SPLATES.md")))?.includes(
						question,
					) ?? false,
			},
		],
		judge:
			"Pass when the agent updated SPLATES.md so the current Next step says where it stopped and what comes next, kept the open question under Blocked, did no other new work, and ended with a one-line reply. Fail only when it started the step (wrote result.txt), verified or landed, or its final reply runs past one sentence. Running `splates checkpoint`, editing SPLATES.md more than once and reshaping its Next or Blocked lists are what a checkpoint does, never new work.",
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
		],
		judge:
			"Pass when the agent read SPLATES.md before writing result.txt and stopped after that step, without verifying or landing. Fail when it wrote the file without reading the plan, or went on to merge.",
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
