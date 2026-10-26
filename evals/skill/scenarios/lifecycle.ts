import { stretches } from "@stringsync/splates-server/plans";
import type { Check, Outcome, Repo, Scenario } from "../scenario";

const aspect = "lifecycle";
const goal = "Change value to two";

/** Whether the agent's reply holds a report of `ending` for `task` (any task when null). */
export function reported(
	reply: string,
	ending: "merged" | "removed" | "done",
	task: string | null = null,
): boolean {
	return stretches(reply).some(
		(part) =>
			part.type === "report" &&
			part.report.ending === ending &&
			(task === null || part.report.task === task),
	);
}

/** Whether the step at `first` comes before the step at `second`; false when `first` is absent. */
export function startsBefore(
	steps: string[],
	first: RegExp,
	second: RegExp,
): boolean {
	const at = steps.findIndex((step) => first.test(step));
	if (at === -1) {
		return false;
	}
	const later = steps.findIndex((step) => second.test(step));
	return later === -1 || at < later;
}

const addsTask = /\bsplates\s+add\b/;
const touchesValue = /value\.txt/;

async function seedValue(repo: Repo): Promise<void> {
	await repo.write("value.txt", "one\n");
	await repo.write(
		"check.ts",
		'if ((await Bun.file("value.txt").text()) !== "two\\n") process.exit(1);\n',
	);
}

/** The task's worktree, as git lists it. */
async function treeOf(repo: Repo, task: string): Promise<string> {
	const listing = await repo.run(["git", "worktree", "list", "--porcelain"]);
	const line = listing
		.split("\n")
		.find((each) => each.startsWith("worktree ") && each.endsWith(`/${task}`));
	if (line === undefined) {
		throw new Error(`no worktree for ${task}`);
	}
	return line.slice("worktree ".length);
}

async function addSample(repo: Repo): Promise<string> {
	await repo.run(["splates", "add", "sample", "--goal", goal]);
	return treeOf(repo, "sample");
}

/** A task whose worktree holds the committed change, as the plan says. */
async function committedTask(repo: Repo): Promise<string> {
	const tree = await addSample(repo);
	await Bun.write(`${tree}/value.txt`, "two\n");
	await repo.run(["git", "-C", tree, "commit", "-qam", goal]);
	return tree;
}

const mainValue = async ({ repo }: Outcome) =>
	(await Bun.file(`${repo.dir}/value.txt`).text()) === "one\n";

const taskGone: Check = {
	id: "task-gone",
	about: "`splates list` no longer shows the task",
	test: async ({ repo }) =>
		!(await repo.run(["splates", "list"])).includes("sample"),
};

const uninitialized: Scenario[] = [
	{
		id: "lifecycle/start",
		aspect,
		requirement:
			"Start a task with `splates add` before reading or editing any project file, and work in its worktree, leaving main untouched.",
		seed: seedValue,
		message: `Change value.txt from one to two. Use task name sample and goal "${goal}". Stop after you have read value.txt, before editing.`,
		checks: [
			{
				id: "add-first",
				about: "ran `splates add` before touching value.txt",
				test: ({ transcript }) =>
					startsBefore(
						transcript.flatMap((step) =>
							step.kind === "tool" ? [step.input] : [],
						),
						addsTask,
						touchesValue,
					),
			},
			{
				id: "main-untouched",
				about: "main's value.txt is still one",
				test: mainValue,
			},
		],
	},
	{
		id: "lifecycle/claim",
		aspect,
		requirement:
			"Resume a task named by `[SPLATES TASK <task>]` with `splates claim`, not a new `splates add`.",
		seed: seedValue,
		change: async (repo) => void (await addSample(repo)),
		message:
			"[SPLATES TASK sample]\nResume the task and inspect value.txt, then stop before editing.",
		checks: [
			{
				id: "claimed",
				about: "ran `splates claim sample`",
				test: ({ commands }) =>
					commands.some((command) =>
						/\bsplates\s+claim\s+sample\b/.test(command),
					),
			},
			{
				id: "no-new-task",
				about: "never ran `splates add`",
				test: ({ commands }) =>
					!commands.some((command) => addsTask.test(command)),
			},
		],
	},
	{
		id: "lifecycle/requested-task",
		aspect,
		requirement:
			"Take a queued task named by `[SPLATES TASK #N]` with `splates add <slug> --task N`, so no other agent starts on it.",
		seed: seedValue,
		change: async (repo) => {
			await repo.run([
				"splates",
				"task",
				"add",
				goal,
				"Change value.txt from one to two.",
				"--slug",
				"value-two",
				"--agent",
				"fake",
			]);
		},
		message: `[SPLATES TASK #1]\nUse task name sample and goal "${goal}". Stop after creating its worktree, before investigating the code.`,
		checks: [
			{
				id: "took-task",
				about: "ran `splates add ... --task 1`",
				test: ({ commands }) =>
					commands.some(
						(command) =>
							addsTask.test(command) && /--task[ =]1\b/.test(command),
					),
			},
		],
	},
	{
		id: "lifecycle/land",
		aspect,
		requirement:
			"With the change committed and verified, land it with `splates merge --message`, never a raw git merge, and report it with the Merged card.",
		seed: seedValue,
		change: async (repo) => void (await committedTask(repo)),
		message:
			"[SPLATES TASK sample]\nThe trivial change is committed. Verify with `bun check.ts` and land the task. No review is requested.",
		checks: [
			{
				id: "landed",
				about: "main's value.txt is two",
				test: async ({ repo }) =>
					(await Bun.file(`${repo.dir}/value.txt`).text()) === "two\n",
			},
			{
				id: "one-commit",
				about: "main gained one commit past the seed",
				test: async ({ repo }) =>
					(
						await repo.run(["git", "rev-list", "--count", "HEAD~1..HEAD"])
					).trim() === "1" &&
					((await repo.run(["git", "log", "-1", "--format=%B"])).trim() !==
						goal) ===
						false,
			},
			{
				id: "no-attribution",
				about: "the landed commit message has no attribution",
				test: async ({ repo }) =>
					!/co-authored-by|generated with|claude/i.test(
						await repo.run(["git", "log", "-1", "--format=%B"]),
					),
			},
			{
				id: "no-raw-merge",
				about: "never ran `git merge`",
				test: ({ commands }) =>
					!commands.some((command) => /\bgit\s+merge\b/.test(command)),
			},
			taskGone,
			{
				id: "merged-card",
				about: "replied with the Merged report for sample",
				test: ({ reply }) => reported(reply, "merged", "sample"),
			},
		],
	},
	{
		id: "lifecycle/remove-moot",
		aspect,
		requirement:
			"When the work is moot, end the task with `splates remove <task> --reason moot` and the Removed card, never a merge.",
		seed: seedValue,
		change: async (repo) => void (await addSample(repo)),
		message:
			"[SPLATES TASK sample]\nThe requested change is obsolete. There are no associated queued tasks. Remove this task as moot and report the outcome.",
		checks: [
			{
				id: "removed",
				about: "ran `splates remove sample --reason moot`",
				test: ({ commands }) =>
					commands.some((command) =>
						/\bsplates\s+remove\s+sample\b.*--reason[ =]moot\b/.test(command),
					),
			},
			taskGone,
			{
				id: "main-unchanged",
				about: "main's value.txt is still one",
				test: mainValue,
			},
			{
				id: "no-merge",
				about: "never ran `splates merge`",
				test: ({ commands }) =>
					!commands.some((command) => /\bsplates\s+merge\b/.test(command)),
			},
			{
				id: "removed-card",
				about: "replied with the Removed report for sample",
				test: ({ reply }) => reported(reply, "removed", "sample"),
			},
		],
	},
];

/** Each starts in an initialized project, so `splates add` works as the skill says. */
export const scenarios: Scenario[] = uninitialized.map((scenario) => ({
	...scenario,
	initialized: true,
}));
