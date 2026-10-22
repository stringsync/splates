import { color, type Logger } from "webappwiz/log";
import type { Fs, HeavyCap, Lock, Ps } from "webappwiz/system";
import { type Clock, SystemClock } from "webappwiz/time";
import type { Tasks } from "../board";
import type { Config } from "../config";
import { LEGACY_PLAN_FILE } from "../config";
import { fail } from "../exit";
import type { Git } from "../git";
import { Notes } from "../notes";
import { PLAN_FILE, Plans, ready, unfinished, whatIsLeft } from "../plans";
import { freedLine, type Slots } from "../ports";
import type { Facts, Journal } from "../records";
import type { CoreClaims } from "../server/shared";
import type { WorktreeService } from "../tasks";
import { recommend, recommendation } from "../tasks";
import type { Shell } from "../terminal";
import { attributeFailure } from "./attribution";
import { pushedLine, type TaskBranches } from "./branches";
import { type GateRunners, MergeGate } from "./gate";
import { landTested } from "./landing";
import { MergeState } from "./merge-state";
import { queueFailedTests } from "./queue-failures";
import { failedTests, failingCases, timedTests } from "./test-report";
import { MergeTiming } from "./timing";
import type { TrunkLanding } from "./trunk";

const TAIL_LINES = 40;

/**
 * Lands the current worktree's branch on its base branch, trunk unless the
 * task was created with `--base`. Never a merge commit: it rebases onto the
 * base, runs the gate there, and fast-forwards the base with
 * compare-and-swap, in whichever worktree has the base checked out.
 * History stays linear.
 *
 * With a central remote, trunk is the remote's: the merge fetches it,
 * rebases onto it, runs the gate, pushes the tested `splates/<task>`, and
 * asks the server to move trunk there, which only it does.
 */
export async function merge(
	{
		service,
		git,
		lock,
		shell,
		config,
		log,
		tasks,
		journal,
		fs,
		slots,
		heavy,
		cores,
		branches,
		trunk,
		ps,
		send,
		clock = new SystemClock(),
	}: {
		service: WorktreeService;
		git: Git;
		lock: Lock;
		shell: Shell;
		config: Config;
		log: Logger;
		tasks: Tasks;
		journal?: Journal;
		fs: Fs;
		slots: Slots;
		heavy: HeavyCap;
		cores: CoreClaims;
		branches: TaskBranches;
		trunk: TrunkLanding;
		/** Reaches the server a runner is asked through; the gate runs here without it. */
		ps?: Ps;
		send?: GateRunners["send"];
		clock?: Clock;
	},
	cwd: string,
	// Filled in as it learns each, so a refusal keeps what it learned before it
	// stopped, which the journal reads once `merge` has returned or thrown.
	facts: Partial<Facts["merge"]> = {},
	{
		message = "",
	}: {
		/** When given, the task's commits are squashed into one with this message first. */
		message?: string;
	} = {},
): Promise<void> {
	using timing = new MergeTiming(facts, clock);
	// Shorter, a squash message is a placeholder such as `X`, not a message.
	if (message !== "" && message.trim().length < 5) {
		fail(
			"usage",
			`--message ${JSON.stringify(message)} is too short to be a commit message: say in at least 5 characters what the base gains, and merge again. No merge attempt was spent.`,
		);
	}
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

	// Printed on every attempt, refused or not, and gates nothing: merge cannot
	// check that a note still holds, so the agent checks its diff against them.
	const notes = await new Notes(fs)
		.list(worktree.path, config)
		.catch((error: unknown) => {
			log.error(
				`project notes not read: ${error instanceof Error ? error.message : String(error)}`,
			);
			return [];
		});
	if (notes.length > 0) {
		log.info(notes.map((note) => note.description).join("\n"));
	}

	const base = worktree.base;
	facts.base = base;
	facts.attemptsLeft = config.mergeRetryCount - worktree.mergeAttempts;
	facts.failedTests = [];
	delete facts.failureAttribution;
	delete facts.output;
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
			`'${task}' has used its ${config.mergeRetryCount} merge attempts: ask the user, who can grant another ${config.mergeRetryCount} with \`splates retry ${task}\`, or \`splates remove ${task}\` and start over against current ${base}`,
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
			`'${task}' is not ready to merge: ${whatIsLeft(left)}. Act on each answer and check it off, or ask the user and end your turn; finish each step and check it off, or \`splates task add\` it and drop it; then merge again`,
			{ task, blocked: left.questions, steps: left.steps },
		);
	}
	const remote = base === config.trunk ? branches.remote() : null;

	// Working until landing holds the lock: waiting and testing must not
	// leave a dead merge's `merging` status showing another landing.
	worktree = await worktree.take({ status: "working" });
	const state = new MergeState(worktree);
	const runner = new MergeGate(
		git,
		shell,
		fs,
		heavy,
		cores,
		config,
		log,
		timing,
		ps === undefined ? null : { ps, ...(send === undefined ? {} : { send }) },
	);
	await using _capacity = await runner.reserve(task);
	const treeLock = service.storage.lock(`merge-trees/${task}.lock`);
	await treeLock.acquire();
	try {
		worktree = await state.requireLease();
		if (message !== "") {
			const squashed = await git.squash(worktree.path, base, message);
			if (squashed !== null && squashed.code !== 0) {
				fail(
					"blocked",
					`could not squash '${task}' into one commit: ${squashed.stderr || squashed.stdout}\nIts commits are as they were. No merge attempt was spent.`,
					{ task },
				);
			}
		}
		for (;;) {
			worktree = await state.requireLease();
			delete facts.failureAttribution;
			delete facts.output;
			facts.failedTests = [];

			const before = await git.head(worktree.path);
			// Trunk as the remote has it, which only the server moves: the
			// commit the gate tests on, and the one the server checks trunk is
			// still at before it lands.
			let onto: string | null = null;
			if (remote !== null) {
				const fetched = await branches.fetchTrunk(task, base, worktree.path);
				if (fetched.status !== "fetched") {
					fail(
						"blocked",
						`could not fetch ${base} from ${remote}: ${fetched.status === "off" ? "no remote is configured" : fetched.why}\nNo merge attempt was spent: merge again once ${remote} can be reached.`,
						{ task, remote },
					);
				}
				onto = fetched.commit;
				if (!(await git.isAncestor(`refs/heads/${base}`, onto))) {
					fail(
						"blocked",
						[
							`${base} here has commits ${remote} lacks, and a merge lands on ${remote}'s ${base}, which would leave them behind.`,
							`Push them first (\`git push ${remote} ${base}\` from ${git.root}), then merge again. No merge attempt was spent.`,
						].join("\n"),
						{ task, remote },
					);
				}
			}
			const rebasedOnto = onto ?? (await git.out(git.root, "rev-parse", base));
			await state.requireLease();
			const rebase = await git.rebase(worktree.path, rebasedOnto);
			await state.requireLease();
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
				await state.refuseIndexLock(
					`${rebase.stdout}\n${rebase.stderr}`,
					paths,
				);
				const reason = paths.length > 0 ? "conflict" : "merge_failed";
				await state.bump(reason, {
					files: paths,
					...(paths.length === 0 && { output }),
				});
				if (paths.length === 0) {
					facts.output = MergeState.said(output);
				}
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
								"If both sides restructured the same logic, ask the user how to combine them,",
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
			const testedHead = await git.head(worktree.path);
			let gated = await runner.run(worktree.path, task);
			await state.requireLease();
			if (gated.exitCode !== 0) {
				const attribution = await attributeFailure({ gate: runner }, gated, {
					cwd: worktree.path,
					task,
					onto: rebasedOnto,
				});
				await state.requireLease();
				facts.failureAttribution = attribution.kind;
				facts.failedTests = attribution.failed.length
					? attribution.failed
					: failedTests(`${gated.stdout}\n${gated.stderr}`);
				await queueFailedTests(
					{ tasks, log, journal },
					task,
					facts.failedTests,
					attribution.kind,
				);
				log.error(attribution.why);
				if (attribution.kind === "flake") {
					gated = await runner.run(worktree.path, task);
					if (gated.exitCode !== 0) {
						// A selective pass cannot excuse a later failure anywhere in the
						// complete gate. Keep the tree out without spending an attempt.
						facts.failureAttribution = "environment";
						const failed = failingCases(gated.xml);
						facts.failedTests = failed.length
							? failed
							: failedTests(`${gated.stdout}\n${gated.stderr}`);
						await queueFailedTests(
							{ tasks, log, journal },
							task,
							facts.failedTests,
							"environment",
						);
					}
				}
			}
			await state.requireLease();
			if (gated.exitCode !== 0) {
				// The rebase already finished, so there is nothing for `rebase --abort`
				// to undo: resetting to the pre-rebase commit is what returns the branch
				// to its previous state.
				await git.resetHard(worktree.path, before);
				const output = `${gated.stdout}\n${gated.stderr}`;
				const failed = failedTests(output);
				const charged = facts.failureAttribution === "task";
				if (charged) {
					await state.bump("tests_failed", {
						tests: facts.failedTests?.map((each) => each.name),
						failures: facts.failedTests,
					});
					facts.attemptsLeft = (facts.attemptsLeft ?? 1) - 1;
				} else {
				}
				const named = facts.failedTests?.length ? facts.failedTests : failed;
				if (named.length === 0) {
					facts.output = MergeState.said(output);
				}
				// The failing tests and what to do come last, after the gate's own
				// output: an agent that reads only the end of this, as through `tail`,
				// would otherwise see the runner's summary alone, and merge again just
				// to read it, which lands the task whenever a flaky test passes.
				fail(
					"tests_failed",
					[
						tail(output),
						"",
						`\`${runner.command}\` failed after rebasing onto ${base} (exit ${gated.exitCode}).`,
						`${base} is untouched and ${branch} is back at ${before.slice(0, 8)}.`,
						charged
							? "The failure was reproduced with the task after passing on the base; one merge attempt was spent."
							: `Failure attribution: ${facts.failureAttribution}. The merge is held; no merge attempt was spent.`,
						"",
						...(named.length > 0
							? [
									`Failing tests (${named.length}):`,
									...named.flatMap((each) => [
										each.name,
										...(each.message === "" ? [] : [indent(each.message)]),
									]),
									"",
								]
							: []),
						"Fix what broke, or run a test you think flaky on its own to check, then merge again. Never merge only to read this again: a merge whose gate passes lands, with the message it was given.",
					].join("\n"),
					{
						task,
						exitCode: gated.exitCode,
						failedTests: named,
						attribution: facts.failureAttribution,
					},
				);
			}

			// A hook that wrote no report, or one that does not parse, times nothing.
			const testTimes = timedTests(gated.xml);

			const result = await landTested(
				{ service, git, lock, branches, trunk },
				worktree,
				{ remote, onto: rebasedOnto, testedHead },
				facts,
			);
			if (result === null) {
				facts.retests = (facts.retests ?? 0) + 1;
				worktree = await worktree.reload();
				continue;
			}
			const { current, head, landing, landed, changed, commits, size } = result;

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
				commit: head,
				commits,
				size,
				testTimes,
			});
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
			// Done is done: the queued tasks this task took up leave the queue with it.
			const done = await tasks.takenBy(task);
			// Read before the queued tasks go, since a lane they empty ends with them.
			const ran = (await tasks.lanes()).filter((lane) =>
				done.some((each) => each.lane === lane.id),
			);
			for (const each of done) {
				await each.remove(head);
			}
			await tasks.endLanes(ran.map((lane) => lane.id));
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
				...done.map((each) => `  done task ${each.id}: ${each.subject}`),
			];
			// Only a landing on trunk ends a piece of work. A part landing on its
			// parent's branch hands back to that parent, which is not done yet.
			if (landing === git.root) {
				lines.push(
					...recommendation(
						await recommend(tasks, task, config.taskStalenessMs, ran),
					),
					// Last, since it is what the agent writes next: the page
					// shows the merge as a card only under this title.
					"",
					`${color.bold("report it")} as \`## ✅ Merged ${task} onto ${base}\`, then a line on what changed for the user; ask and offer nothing`,
				);
			}
			log.info(lines.join("\n"));
			return;
		}
	} finally {
		await treeLock.release();
	}
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
