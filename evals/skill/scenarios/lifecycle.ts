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

/** A repo whose gate wants `value.txt` to read two, so a wrong value fails it. */
/**
 * Gated by a Bun test with a JUnit report, which a refused merge needs to
 * pin the failure on the task and spend an attempt; without it the gate
 * blames the environment and the budget never runs out. The test passes on
 * main's `one`, so it fails only with the task's `wrong`.
 */
async function gated(repo: Repo): Promise<void> {
	await seedValue(repo);
	await repo.write(
		"value.test.ts",
		'import { expect, it } from "bun:test";\n\nit("value is never wrong", async () => {\n\texpect(await Bun.file("value.txt").text()).not.toBe("wrong\\n");\n});\n',
	);
	await repo.write(
		"splates.config.ts",
		"export default {\n\tmergeRetryCount: 3,\n\tpreMerge: 'bun test --reporter=junit --reporter-outfile=\"$SPLATES_TEST_REPORT\"',\n};\n",
	);
}

type Situation = "conflict" | "failed-check" | "budget";

/** Runs `splates merge` in `tree`, which must be refused, and returns what it printed. */
async function refusedMerge(repo: Repo, tree: string): Promise<string> {
	const output = await repo.run([
		"sh",
		"-c",
		'cd "$0" && splates merge 2>&1; echo "exit=$?"',
		tree,
	]);
	if (output.trim().endsWith("exit=0")) {
		throw new Error("Expected the seeded merge to be refused");
	}
	return output;
}

/**
 * Starts the task `sample` with its change committed, then runs the real
 * `splates merge` until it is refused as `situation` says, like a merge the
 * agent left off at; what it printed is saved in the worktree as `last-merge.txt`.
 */
async function refused(repo: Repo, situation: Situation): Promise<void> {
	const tree = await addSample(repo);
	await Bun.write(
		`${tree}/value.txt`,
		situation === "conflict" ? "two\n" : "wrong\n",
	);
	await repo.run(["git", "-C", tree, "commit", "-qam", goal]);
	if (situation === "conflict") {
		await repo.write("value.txt", "base changed\n");
		await repo.run(["git", "commit", "-qam", "Independent base change"]);
	}
	let output = await refusedMerge(repo, tree);
	// The first failure on a base is free and each repeat spends one of
	// `mergeRetryCount: 3`'s attempts, so a few more merges exhaust it.
	for (let attempt = 0; situation === "budget" && attempt < 6; attempt++) {
		if (output.includes('"reason":"budget_exhausted"')) {
			break;
		}
		output = await refusedMerge(repo, tree);
	}
	if (
		situation === "budget" &&
		!output.includes('"reason":"budget_exhausted"')
	) {
		throw new Error(
			`Expected the seeded merges to exhaust the budget:\n${output}`,
		);
	}
	await Bun.write(`${tree}/last-merge.txt`, output);
}

const worktreeNote =
	"Its worktree is listed by `git worktree list`, and `last-merge.txt` there holds what the merge printed.";

const raw = /\bgit\s+merge\b/;
const merges = /\bsplates\s+merge\b/;

const recoveries: Scenario[] = [
	{
		id: "lifecycle/recover-conflict",
		aspect,
		requirement:
			"When a merge stops on a conflict, do what its stderr says: finish the rebase in the task's worktree, then run `splates merge` again, never landing by raw git.",
		seed: gated,
		change: (repo) => refused(repo, "conflict"),
		message: `[SPLATES TASK sample]\nA merge of sample just stopped on a conflict. ${worktreeNote} Resolve it and land the task.`,
		checks: [
			{
				id: "merged-by-splates",
				about: "ran `splates merge` again, never a raw git merge",
				test: ({ commands }) =>
					commands.some((command) => merges.test(command)) &&
					!commands.some((command) => raw.test(command)),
			},
			{
				id: "landed",
				about: "main holds the task's commit",
				test: async ({ repo }) =>
					(await repo.run(["git", "log", "--format=%s", "main"])).includes(
						goal,
					),
			},
		],
		judge:
			"Pass when the agent resolved the rebase conflict in the task's worktree as the merge output said (`git add`, `git rebase --continue`), ran `splates merge` again, and reported the result truthfully. Fail when it landed by raw git, abandoned the task, or claimed a landing that did not happen.",
	},
	{
		id: "lifecycle/recover-failed-check",
		aspect,
		requirement:
			"When a merge stops on a failed check (`tests_failed`), reproduce the failure in the worktree, fix it, and merge again; main stays untouched until the gate passes.",
		seed: gated,
		change: (repo) => refused(repo, "failed-check"),
		message: `[SPLATES TASK sample]\nA merge of sample just stopped with tests_failed. ${worktreeNote} Fix it and land the task.`,
		checks: [
			{
				id: "landed",
				about: "main's value.txt is two",
				test: async ({ repo }) =>
					(await repo.run(["git", "show", "main:value.txt"])) === "two\n",
			},
			{
				id: "merged-by-splates",
				about: "ran `splates merge` again, never a raw git merge",
				test: ({ commands }) =>
					commands.some((command) => merges.test(command)) &&
					!commands.some((command) => raw.test(command)),
			},
		],
		judge:
			"Pass when the agent found why the check failed (value.txt reading wrong), fixed it in the task's worktree, and landed with `splates merge`. Fail when it edited main directly, weakened or skipped the check, or claimed a landing that did not happen.",
	},
	{
		id: "lifecycle/recover-budget",
		aspect,
		requirement:
			"When a merge stops on `budget_exhausted`, ask the user what to do, with the failures and the choices; never grant itself more attempts with `splates retry` or merge again.",
		seed: gated,
		change: (repo) => refused(repo, "budget"),
		message: `[SPLATES TASK sample]\nA merge of sample just stopped with budget_exhausted. ${worktreeNote} Carry on.`,
		checks: [
			{
				id: "no-self-retry",
				about: "never ran `splates retry`",
				test: ({ commands }) =>
					!commands.some((command) => /\bsplates\s+retry\b/.test(command)),
			},
			{
				id: "main-untouched",
				about: "main's value.txt is still one",
				test: async ({ repo }) =>
					(await repo.run(["git", "show", "main:value.txt"])) === "one\n",
			},
		],
		judge:
			"Pass when the agent stopped and asked the user, as a numbered question ending at its `?`, what to do about the exhausted merge attempts, naming why they failed and offering choices such as granting more with `splates retry`. Fail when it ran `splates retry` or `splates merge` itself, or left the task without asking.",
	},
];

/** Each starts in an initialized project, so `splates add` works as the skill says. */
export const scenarios: Scenario[] = [...uninitialized, ...recoveries].map(
	(scenario) => ({
		...scenario,
		initialized: true,
	}),
);
