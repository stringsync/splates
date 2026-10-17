import { color, type Logger } from "webappwiz/log";
import type { Fs, HeavyCap, Lock } from "webappwiz/system";
import type { Config } from "./config";
import type { Facts } from "./events";
import { fail } from "./exit";
import type { Git } from "./git";
import { LEGACY_PLAN_FILE } from "./legacy-names";
import { PLAN_FILE, Plans, ready, unfinished, whatIsLeft } from "./plan";
import { recommend, recommendation } from "./recommend";
import type { Shell } from "./shell";
import { freedLine, type Slots } from "./slots";
import { pushedLine, type TaskBranches } from "./task-branches";
import type { Todos } from "./todos";
import type { Landed, TrunkLanding } from "./trunk-landing";
import type {
	FailedTest,
	GateFailure,
	MergeFailure,
	Worktree,
} from "./worktree";
import type { WorktreeService } from "./worktree-service";

const TAIL_LINES = 40;
/** The most lines kept of what one failed test said. */
const MESSAGE_LINES = 30;

/**
 * Lands the current worktree's branch on its base branch, trunk unless the
 * task was created with `--base`. Never a merge commit: it rebases onto the
 * base, runs the gate there, and fast-forwards the base with
 * `git merge --ff-only`, in whichever worktree has the base checked out.
 * History stays linear.
 *
 * With a central remote, trunk is the remote's: the merge fetches it,
 * rebases onto it, runs the gate, pushes the tested `splates/<task>`, and
 * asks the coordinator to move trunk there, which only it does.
 */
export async function merge(
	{
		service,
		git,
		lock,
		shell,
		config,
		log,
		todos,
		fs,
		slots,
		heavy,
		branches,
		trunk,
		relayed = false,
	}: {
		service: WorktreeService;
		git: Git;
		lock: Lock;
		shell: Shell;
		config: Config;
		log: Logger;
		todos: Todos;
		fs: Fs;
		slots: Slots;
		heavy: HeavyCap;
		branches: TaskBranches;
		trunk: TrunkLanding;
		/** Whether this runs on a worker, whose records are the coordinator's. */
		relayed?: boolean;
	},
	cwd: string,
	// Filled in as it learns each, so a refusal keeps what it learned before it
	// stopped, which the journal reads once `merge` has returned or thrown.
	facts: Partial<Facts["merge"]> = {},
): Promise<void> {
	const branch = await git.currentBranch(cwd);
	const task = service.taskFor(branch);
	if (!task) {
		fail(
			"not_found",
			`not in a task worktree (${branch === null ? "no branch" : `branch '${branch}'`}): run merge from a worktree made by \`splates add\``,
			{ branch },
		);
	}
	let worktree = await service.find(task);
	if (!worktree.state) {
		fail(
			"not_found",
			`no state file for '${task}': run \`splates claim ${task}\` first`,
			{ task },
		);
	}

	const base = worktree.base;
	facts.base = base;
	facts.attemptsLeft = config.mergeRetryCount - worktree.mergeAttempts;
	facts.failedTests = [];
	const dirty = await worktree.uncommitted();
	if (dirty.length > 0) {
		fail(
			"dirty",
			`'${task}' has uncommitted changes: commit them before merging`,
			{ task, paths: dirty },
		);
	}
	// The plan is the task's own, kept beside the code and never in it: a
	// branch that tracks it would land it on the base for every task to share.
	const plans = await git.tracked(`refs/heads/${worktree.branch}`, [
		PLAN_FILE,
		LEGACY_PLAN_FILE,
	]);
	if (plans.length > 0) {
		fail(
			"blocked",
			`'${task}' tracks ${plans.join(" and ")}, which must never land on ${base}: \`git rm --cached ${plans.join(" ")}\`, commit, and merge again. No merge attempt was spent.`,
			{ task, paths: plans },
		);
	}
	if (worktree.mergeAttempts >= config.mergeRetryCount) {
		// Once per budget: an agent that keeps trying is one refusal, not many.
		if (worktree.state.gateFailures?.at(-1)?.reason !== "budget_exhausted") {
			await worktree.save({
				gateFailures: [
					...(worktree.state.gateFailures ?? []),
					{ reason: "budget_exhausted", at: new Date().toISOString() },
				],
			});
		}
		fail(
			"budget_exhausted",
			`'${task}' has used its ${config.mergeRetryCount} merge attempts: run \`splates escalate <reason>\`, and a human can grant another ${config.mergeRetryCount} with \`splates retry ${task}\`; or \`splates remove ${task}\` and start over against current ${base}`,
			{ task, mergeAttempts: worktree.mergeAttempts },
		);
	}
	if (worktree.leaseHeldByOther) {
		fail(
			"lease_held",
			`'${task}' is held by pid ${worktree.lease?.pid} on ${worktree.lease?.hostname}: another agent is driving this tree`,
			{ task, lease: worktree.lease },
		);
	}
	// An unchecked question is one the user has yet to answer, or an answer
	// the agent has yet to act on; an unchecked step is work not yet done.
	const left = unfinished((await new Plans(fs).read(worktree.path)) ?? "");
	if (!ready(left)) {
		fail(
			"blocked",
			`'${task}' is not ready to merge: ${whatIsLeft(left)}. Act on each answer and check it off, or escalate and ask the user in chat; finish each step and move it to ## Done, or \`splates todo add\` it and drop it; then merge again`,
			{ task, blocked: left.questions, steps: left.steps },
		);
	}
	const remote = base === config.trunk ? branches.remote() : null;
	if (relayed && base === config.trunk && remote === null) {
		fail(
			"blocked",
			`'${task}' runs on a worker, which lands on ${base} only through the central remote: set \`remote\` in splates.config.ts. No merge attempt was spent.`,
			{ task },
		);
	}
	worktree = await worktree.take();

	// Blocks until free: an agent told "busy, try later" goes and edits code in
	// a branch that is supposed to be frozen.
	await lock.acquire();
	worktree = await worktree.take({ status: "merging" });

	const before = await git.head(worktree.path);
	// Trunk as the remote has it, which only the coordinator moves: the
	// commit the gate tests on, and the one the coordinator checks trunk is
	// still at before it lands.
	let onto: string | null = null;
	if (remote !== null) {
		const fetched = await branches.fetchTrunk(task, base, worktree.path);
		if (fetched.status !== "fetched") {
			await lock.release();
			await worktree.take({ status: "working" });
			fail(
				"blocked",
				`could not fetch ${base} from ${remote}: ${fetched.status === "off" ? "no remote is configured" : fetched.why}\nNo merge attempt was spent: merge again once ${remote} can be reached.`,
				{ task, remote },
			);
		}
		onto = fetched.commit;
		if (!relayed && !(await git.isAncestor(`refs/heads/${base}`, onto))) {
			await lock.release();
			await worktree.take({ status: "working" });
			fail(
				"blocked",
				[
					`${base} here has commits ${remote} lacks, and a merge lands on ${remote}'s ${base}, which would leave them behind.`,
					`Push them first (\`git push ${remote} ${base}\` from ${git.root}), then merge again. No merge attempt was spent.`,
				].join("\n"),
				{ task, remote },
			);
		}
		if (relayed) {
			// A worker's own trunk follows the remote's, so what the task
			// changed reads against what it rebased onto.
			await git.run(git.root, "branch", "--force", base, onto);
		}
	}
	const rebase = await git.rebase(worktree.path, onto ?? base);
	if (rebase.code !== 0) {
		// Left in progress on purpose: the agent needs the conflict markers.
		const paths = await git.conflictedPaths(worktree.path);
		facts.files = paths;
		// A rebase can fail with no file in conflict (an untracked file in the
		// way, a locked index, a refusing hook): git then often aborted itself,
		// so there is nothing to resolve or continue, and its words are the
		// only clue.
		const inProgress = (await git.interruptedOps(worktree.path)).length > 0;
		const output = tail(`${rebase.stdout}\n${rebase.stderr}`);
		await lock.release();
		await refuseIndexLock(
			worktree,
			`${rebase.stdout}\n${rebase.stderr}`,
			paths,
		);
		const reason = paths.length > 0 ? "conflict" : "merge_failed";
		await bump(worktree, reason, {
			files: paths,
			...(paths.length === 0 && { output }),
		});
		facts.attemptsLeft = (facts.attemptsLeft ?? 1) - 1;
		fail(
			reason,
			paths.length > 0
				? [
						`rebase onto ${base} conflicted in ${paths.length} file(s):`,
						...paths.map((file) => `  ${file}`),
						"",
						"The rebase is still in progress. Resolve the conflicts, `git add` them,",
						"`git rebase --continue`, then run `splates merge` again.",
						"If both sides restructured the same logic, prefer `splates escalate <reason>`",
						`or \`splates remove ${task}\` and redo the task against current ${base}.`,
					].join("\n")
				: [
						`rebase onto ${base} failed with no file in conflict (exit ${rebase.code}). Git said:`,
						indent(output),
						"",
						inProgress
							? "The rebase is still in progress: finish it (`git rebase --continue`, or `--skip` for a commit that became empty), then run `splates merge` again."
							: "Git stopped the rebase itself, so there is nothing to resolve: fix what it names, then run `splates merge` again.",
					].join("\n"),
			{ task, paths },
		);
	}

	// After the rebase, never before: a branch that passed against an older
	// trunk tells you nothing about the combination. This is the only thing
	// standing between semantic conflicts and a broken trunk, and a repo that
	// configures neither hook has chosen to go without it.
	//
	// The two hooks share one shell rather than getting a run each: the recovery
	// is the same either way, and one gate reports one failure however far down
	// it got.
	const gate = [config.postRewrite, config.preMerge]
		.filter(Boolean)
		.join(" && ");
	const gated = gate
		? await (async () => {
				// A test run is the heaviest thing an agent does, so it waits its
				// turn with every other on the machine.
				await using slot = await heavy.take({ what: "preMerge", task });
				// Awaited, or the slot goes back before the hook ends.
				return await shell.run(gate, worktree.path, {
					env: {
						SPLATES_TASK: task,
						SPLATES_WORKTREE: worktree.path,
						...slot.env,
					},
				});
			})()
		: { exitCode: 0, stdout: "", stderr: "" };
	if (gated.exitCode !== 0) {
		// The rebase already finished, so there is nothing for `rebase --abort`
		// to undo: resetting to the pre-rebase commit is what returns the branch
		// to its previous state.
		await git.resetHard(worktree.path, before);
		await lock.release();
		const output = `${gated.stdout}\n${gated.stderr}`;
		const failed = failedTests(output);
		await bump(worktree, "tests_failed", {
			tests: failed.map((each) => each.name),
			failures: failed,
		});
		facts.attemptsLeft = (facts.attemptsLeft ?? 1) - 1;
		facts.failedTests = failed;
		fail(
			"tests_failed",
			[
				`\`${gate}\` failed after rebasing onto ${base} (exit ${gated.exitCode}).`,
				`${base} is untouched and ${branch} is back at ${before.slice(0, 8)}.`,
				"",
				...(failed.length > 0
					? [
							`Failing tests (${failed.length}):`,
							...failed.flatMap((each) => [
								each.name,
								...(each.message === "" ? [] : [indent(each.message)]),
							]),
							"",
						]
					: []),
				tail(output),
			].join("\n"),
			{ task, exitCode: gated.exitCode, failedTests: failed },
		);
	}

	// Deliberately re-read from disk rather than trusting the copy in hand: a
	// long test run can outlive the lease, and landing after someone else
	// claimed the tree would land work that is no longer ours.
	const current = await worktree.reload();
	if (!current.leaseOurs) {
		await lock.release();
		fail(
			"lease_lost",
			`the lease on '${task}' was taken by pid ${current.lease?.pid} during the merge, stopping without landing. Do not retry; another agent owns this tree.`,
			{ task, lease: current.lease },
		);
	}

	// A branch can only be advanced where it is checked out: git allows one
	// worktree per branch, and moving the ref behind that worktree's back would
	// leave its index and files on the old commit. For trunk that tree is the
	// main one; for a task created with `--base task/<other>` it is that task's
	// worktree, and the work lands there rather than on trunk.
	// Read while the branch is still ahead of its base: once it lands there
	// is nothing between them to read, and the outcome needs what it touched.
	const changed = (await current.changedFiles()) ?? [];
	const commits = (await current.commitMessages()) ?? undefined;
	const size = (await current.size()) ?? undefined;
	const landed =
		remote !== null && onto !== null
			? await landOnRemote({
					git,
					branches,
					trunk,
					worktree: current,
					remote,
					onto,
					relayed,
					holder: { pid: service.ps.pid, hostname: service.ps.hostname },
				})
			: null;
	if (landed !== null && landed.status === "refused") {
		await lock.release();
		await bump(current, "merge_failed", { error: landed.why });
		facts.attemptsLeft = (facts.attemptsLeft ?? 1) - 1;
		fail(
			"merge_failed",
			[
				`could not land ${branch} on ${remote}'s ${base}: ${landed.why}`,
				`${base} is untouched; ${branch} stays rebased and tested. Merge again.`,
			].join("\n"),
			{ task, base, remote },
		);
	}
	const holder = landed === null ? await git.worktreeFor(base) : null;
	const landing = holder ?? git.root;
	const checkout = landed !== null || holder ? null : await git.checkout(base);
	const merged =
		landed !== null
			? { code: 0, stdout: "", stderr: "" }
			: checkout && checkout.code !== 0
				? checkout
				: await git.mergeFfOnly(landing, service.branchFor(task));
	if (merged.code !== 0) {
		await lock.release();
		await refuseIndexLock(worktree, `${merged.stdout}\n${merged.stderr}`);
		await bump(worktree, "merge_failed", {
			error: (merged.stderr || merged.stdout).trim(),
		});
		facts.attemptsLeft = (facts.attemptsLeft ?? 1) - 1;
		// Said to the agent landing the part, not the one holding the tree: telling
		// it to stash sends it into a tree it does not own, and a stash there is
		// how another agent's work gets lost.
		const holderTask = service.taskFor(base);
		const whoever = holderTask
			? `The agent working on '${holderTask}'`
			: "Whoever is working in that tree";
		fail(
			"merge_failed",
			[
				`could not fast-forward ${base} in ${landing}: ${merged.stderr || merged.stdout}`,
				...(landing === git.root
					? []
					: [
							"",
							`${base} is checked out there, which is the only place it can move.`,
							`${whoever} has to commit what collides; leave that tree alone`,
							"and tell them, then merge again once they have.",
						]),
			].join("\n"),
			{ task, base, landing },
		);
	}

	const head =
		landed === null
			? await git.shortHead(landing)
			: (await git.out(current.path, "rev-parse", "--short", "HEAD")).trim();
	facts.commit = head;
	facts.files = changed;
	// The work is on the base, so the tree has nothing left to hold. Discarding it
	// here is what keeps `splates list` a list of live work rather than a graveyard
	// of landed tasks.
	//
	// Step out of it first: merge usually runs from inside the tree it is about
	// to delete, and spawning git from a directory that no longer exists fails
	// with ENOENT before git is even reached.
	service.ps.cd(git.root);
	const discarded = await current.discard("merged", {
		changed,
		commits,
		size,
	});
	await lock.release();
	if (discarded.code !== 0) {
		fail(
			"usage",
			`landed '${task}' on ${base} (${head}) but could not discard its worktree: ${discarded.stderr || discarded.stdout}\nRun \`splates remove ${task}\` to clean up.`,
			{ task },
		);
	}
	const freed = await slots.release(current.path);
	// Landed is landed: a remote that kept its copy only has a stray branch.
	const unpushed = pushedLine(await branches.delete(task), "deleted");
	// Done is done: the todos this task took up leave the list with it.
	const done = await todos.takenBy(task);
	// Read before the todos go, since a lane they empty ends with them.
	const ran = (await todos.lanes()).filter((lane) =>
		done.some((todo) => todo.lane === lane.id),
	);
	for (const todo of done) {
		await todo.remove();
	}
	await todos.endLanes(ran.map((lane) => lane.id));
	const lines = [
		`${color.green("merged")} ${task} onto ${base} (${head})${
			landing === git.root ? "" : `\n  landed in: ${landing}`
		}\n  worktree removed, cd ${git.root}`,
		...(landed !== null && landed.local !== "moved"
			? [
					color.yellow(
						`  ${base} here could not follow ${remote}: ${landed.local.stuck}\n  It landed on ${remote}; bring this checkout up with \`git pull --ff-only\`.`,
					),
				]
			: []),
		...(freed === null ? [] : [`  slot ${freedLine(freed)}`]),
		...(unpushed === null ? [] : [unpushed]),
		...done.map((todo) => `  done todo ${todo.id}: ${todo.subject}`),
	];
	// Only a landing on trunk ends a piece of work. A part landing on its
	// parent's branch hands back to that parent, which is not done yet.
	if (landing === git.root) {
		lines.push(
			...recommendation(
				await recommend(todos, task, config.todoStalenessMs, ran),
			),
		);
	}
	log.info(lines.join("\n"));
}

/**
 * Pushes the tested branch as `splates/<task>` and asks the coordinator to
 * move the remote's trunk to it from `onto`, the commit it was tested on.
 */
async function landOnRemote({
	git,
	branches,
	trunk,
	worktree,
	remote,
	onto,
	relayed,
	holder,
}: {
	git: Git;
	branches: TaskBranches;
	trunk: TrunkLanding;
	worktree: Worktree;
	remote: string;
	onto: string;
	relayed: boolean;
	holder: { pid: number; hostname: string };
}): Promise<Landed> {
	const pushed = await branches.push(worktree.task, worktree.branch);
	if (pushed.status !== "pushed") {
		return {
			status: "refused",
			why: `${branches.pushedBranch(worktree.task)} was not pushed to ${remote}: ${pushed.status === "off" ? "no remote is configured" : pushed.why}`,
		};
	}
	const head = await git.head(worktree.path);
	const landed = await trunk.land({
		task: worktree.task,
		onto,
		head,
		holder,
	});
	if (landed.status === "landed" && relayed) {
		await git.run(git.root, "branch", "--force", worktree.base, head);
	}
	return landed;
}

/** Git owns its lock: neither its age nor an absent open fd proves it stale. */
async function refuseIndexLock(
	worktree: Worktree,
	output: string,
	conflicts: string[] = [],
): Promise<void> {
	if (
		conflicts.length > 0 ||
		!/Unable to create ['"].*[/\\]index\.lock['"]: File exists/i.test(output)
	) {
		return;
	}
	await worktree.take({ status: "working" });
	fail(
		"blocked",
		[
			"Git could not acquire index.lock; this is lock contention, not a content conflict. No merge attempt was spent.",
			indent(tail(output)),
			"Wait for the Git operation using this worktree to finish, then run `splates merge` again. Splates has left the lock untouched.",
			"If Git left a rebase in progress, finish it after the lock is released (`git rebase --continue`) before merging again.",
			"If it persists, investigate its owner before any manual recovery; never delete a lock held by a live operation.",
		].join("\n"),
		{ task: worktree.task },
	);
}

async function bump(
	worktree: Worktree,
	reason: MergeFailure,
	named: Omit<GateFailure, "reason" | "at">,
): Promise<void> {
	const by = worktree.state?.mergeFailuresBy ?? {};
	await worktree.take({
		status: "working",
		mergeAttempts: worktree.mergeAttempts + 1,
		mergeFailures: (worktree.state?.mergeFailures ?? 0) + 1,
		mergeFailuresBy: { ...by, [reason]: (by[reason] ?? 0) + 1 },
		gateFailures: [
			...(worktree.state?.gateFailures ?? []),
			{ reason, at: new Date().toISOString(), ...named },
		],
	});
}

function tail(output: string): string {
	return output.trim().split("\n").slice(-TAIL_LINES).join("\n");
}

function indent(text: string): string {
	return text
		.split("\n")
		.map((line) => `    ${line}`)
		.join("\n");
}

/**
 * The tests a runner reported as failing, each with what it said, which the
 * tail cuts off. Another runner prints none, so the tail alone is what the
 * agent gets.
 */
export function failedTests(output: string): FailedTest[] {
	// bun prints each as a `(fail) name` line well before the summary, with the
	// expect diff or error and its stack just above it.
	const lines = output.split("\n");
	const found = new Map<string, string>();
	let start = 0;
	lines.forEach((line, index) => {
		const name = FAIL_LINE.exec(line)?.[1];
		if (name === undefined) {
			return;
		}
		if (!found.has(name)) {
			found.set(
				name,
				lines
					.slice(Math.max(start, index - MESSAGE_LINES), index)
					.concat(afterFail(lines[index + 1]))
					.join("\n")
					.trim(),
			);
		}
		start = index + 1;
	});
	return [...found].map(([name, message]) => ({ name, message }));
}

// bun prints a timed-out test's only explanation on the line after its name,
// so the lines above it are another test's noise
function afterFail(next: string | undefined): string[] {
	return next !== undefined && /^\s*\^ /.test(next) ? [next.trim()] : [];
}

const FAIL_LINE = /^\s*\(fail\)\s+(.+?)(?:\s+\[[\d.]+ ?m?s\])?\s*$/;
