// vet-ignore-file compact-files: one merge is one sequence of steps (rebase, checks, gate, landing) that reads top to bottom; it predates the rule
import { color, type Logger } from "core/log";
import type { Fs, Lock } from "core/system";
import { type Clock, Duration, SystemClock } from "core/time";
import type { Tasks } from "../board";
import type { Config } from "../config";
import { fail } from "../exit";
import type { Git } from "../git";
import type { Slots } from "../ports";
import type { Facts, Journal } from "../records";
import type { PlacedLock } from "../server/shared";
import type { LivePhase, MergeStep, Worktree, WorktreeService } from "../tasks";
import type { Shell } from "../terminal";
import { attributeFailure } from "./attribution";
import type { TaskBranches } from "./branches";
import { clearGate } from "./clear-gate";
import { GateTrail } from "./cores";
import { finishLanding } from "./finish";
import { conflictsOnBase, type Followed, follow, waitAlone } from "./follow";
import { type Checkout, MergeGate } from "./gate";
import { landTested } from "./landing";
import { type Member, MergeLine } from "./line";
import { MergeState } from "./merge-state";
import { refuseFailedChecks } from "./pre-lock";
import { refuseUnready } from "./preflight";
import { allQuarantined, quarantinedTests } from "./quarantine";
import { queueFailedTests } from "./queue-failures";
import { BaseRebase } from "./rebase";
import { recentFailedFiles } from "./recent-failures";
import { refuseTestsFailed, shown } from "./refusal";
import { splitBatch } from "./split";
import { MergeSteps } from "./steps";
import { failedTests, failingCases, timedTests } from "./test-report";
import { MergeTiming } from "./timing";
import type { TrunkLanding } from "./trunk";

/**
 * Lands the current worktree's branch on its base branch, trunk unless the
 * task was created with `--base`, once the gate passes on it. Merges
 * waiting for the gate at once land as one batch.
 */
// Rebased onto the base, gated there and fast-forwarded by compare-and-swap
// in whichever worktree has the base checked out: never a merge commit, so
// history stays linear. With a central remote, trunk is the remote's: the
// merge fetches it, rebases onto it, runs the gate, pushes the tested
// `splates/<task>` and asks the server to move trunk there, which only it
// does. A batch's first merge stacks the others' branches on its own and
// gates the stack's tip once; a failing batch is split by whose commits the
// failing tests first fail with. Merges wait in the project's `MergeLine`,
// which the server's one process holds for every merge it runs.
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
		premerge,
		gateTimeoutMs,
		phasesEveryMs,
		branches,
		trunk,
		line = MergeLine.of(git.root, log),
		clock = new SystemClock(),
		asking,
	}: {
		service: WorktreeService;
		git: Git;
		lock: Lock;
		shell: Shell;
		config: Config;
		log: Logger;
		tasks: Tasks;
		journal: Journal;
		fs: Fs;
		slots: Slots;
		/** The machine's premerge lock, so one gate runs at a time. */
		premerge: PlacedLock;
		/** How long the gate may run before it is killed; `PREMERGE_TIMEOUT_MS` for none. */
		gateTimeoutMs?: number;
		/** How often the gate's premerge phases are read onto the record; `PHASES_EVERY_MS` by default. */
		phasesEveryMs?: number;
		branches: TaskBranches;
		trunk: TrunkLanding;
		/** Where this merge forms or joins a batch with the others waiting. */
		line?: MergeLine;
		clock?: Clock;
		/** The numbers of a task's question cards no reply has answered, read from its conversation. */
		asking?: (task: string) => Promise<string[]>;
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

	const base = worktree.base;
	facts.attemptsLeft = config.mergeRetryCount - worktree.mergeAttempts;
	facts.conflictsLeft = config.mergeConflictCount - worktree.conflictAttempts;
	Object.assign(facts, { base, failedTests: [], began: null });
	delete facts.failureAttribution;
	delete facts.output;
	await refuseUnready(
		{ git, fs, config, log },
		worktree,
		async () => (await asking?.(task)) ?? [],
	);
	const remote = base === config.trunk ? branches.remote() : null;

	const runner = new MergeGate(
		git,
		shell,
		fs,
		config,
		timing,
		premerge,
		GateTrail.ofMachine(fs, service.ps),
		gateTimeoutMs,
		phasesEveryMs,
	);
	// Working until landing holds the lock: waiting and testing must not
	// leave a dead merge's `merging` status showing another landing. The
	// page reads `gate` and `mergeSince` meanwhile, for as long as this merge
	// holds the lease, and `mergeSteps` to show it moving.
	const steps = new MergeSteps(clock);
	timing.stepping(steps);
	worktree = await worktree.take({
		status: "working",
		mergeSince: new Date().toISOString(),
		mergeSteps: steps.enter("rebase"),
		...(runner.command ? { gate: "queued" as const } : {}),
	});
	const enter = async (step: MergeStep, output?: string) => {
		worktree = await worktree.save({ mergeSteps: steps.enter(step, output) });
	};
	// The checks and the premerge print into the task's git directory, for
	// the page to follow as they run; it goes with the worktree.
	const gitDir = (
		await git.out(worktree.path, "rev-parse", "--absolute-git-dir")
	).trim();
	const outputOf = (step: MergeStep) => steps.outputOf(gitDir, step);
	const onPhases = async (phases: LivePhase[]) => {
		worktree = await worktree.save({ mergeSteps: steps.phased(phases) });
	};
	await using _gate = {
		[Symbol.asyncDispose]: () => clearGate(service, task),
	};
	const state = new MergeState(worktree);
	const rebase = new BaseRebase(
		{ git, branches, state },
		{ task, base, remote, path: worktree.path },
		facts,
	);
	const rebaseOntoBase = () => rebase.onto();
	const ticket = state.line();
	const treeLock = service.storage.lock(`merge-trees/${task}.lock`);
	await treeLock.acquire();
	try {
		worktree = await state.requireLease();
		worktree = await offStack(git, worktree);
		// Before the wait: a conflict costs the agent none of it.
		const firstOnto = await rebaseOntoBase();
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
		// The branch's tip on the base alone, which a batch stacks on its tip
		// and sends it back to; and what it changes, read while nothing else
		// is between it and the base, since a batch lands it with others' work.
		const ownHead = await git.head(worktree.path);
		const own = {
			changed: (await worktree.changedFiles()) ?? [],
			commits: (await worktree.commitMessages()) ?? undefined,
			size: (await worktree.size()) ?? undefined,
		};
		let queuedBefore = false;
		let lastPlace: number | undefined;
		// On a batch's stack, its gate is this merge's: a place in line that
		// moves meanwhile is kept for when the batch lets the branch go.
		let stacked = false;
		const onQueued = async (place: number) => {
			if (!queuedBefore) {
				queuedBefore = true;
				facts.began = await journal.begin("merge queued", task, {});
			}
			lastPlace = place;
			if (stacked) {
				return;
			}
			worktree = await worktree.save({
				mergePlace: place,
				mergeSteps: steps.enter("wait"),
			});
		};
		let started = false;
		// Every step names the first, so the page folds them into one run.
		const startGate = async () => {
			if (runner.command) {
				worktree = await worktree.save({
					gate: "running",
					mergePlace: undefined,
					mergeSteps: steps.enter("test", outputOf("test")),
				});
			}
			if (started) {
				return;
			}
			started = true;
			const queued = facts.began ?? null;
			const begun = await journal.begin("merge start", task, {
				began: queued,
			});
			facts.began = queued ?? begun ?? null;
		};
		if (runner.command && runner.preLock) {
			const output = outputOf("check");
			await enter("check", output);
			await refuseFailedChecks(
				{ git, service, state, log, runner },
				{
					task,
					branch: worktree.branch,
					base,
					cwd: worktree.path,
					onto: firstOnto,
					testedHead: ownHead,
					lastBase: rebase.lastBase ?? null,
					output,
				},
				facts,
			);
		}
		// Only a gated merge landing here batches: with a central remote each
		// task pushes its own tested branch for the server to land.
		const batching = remote === null && runner.command !== "";
		// While waiting, a base that moved under the branch and now conflicts
		// with it ends the wait: the rebase after refuses it as it would
		// have, without the line. Never lets anything through.
		const doomed = conflictsOnBase(git, base, firstOnto, ownHead);
		const watching = remote === null && runner.command !== "";
		let followed: Followed;
		if (batching) {
			followed = await follow(
				{ line, git, log, doomed: watching ? doomed : undefined },
				{
					task,
					base,
					path: worktree.path,
					ownHead,
					requireLease: () => state.requireLease(),
					onStacked: async (head) => {
						stacked = true;
						// Kept so a merge cut off on the stack is put back on its own head.
						worktree = await worktree.save({
							mergeStack: { own: ownHead, head },
						});
						await startGate();
					},
					onUnstacked: async (dissolved) => {
						stacked = false;
						worktree = await worktree.save({
							mergeStack: undefined,
							gate: "queued",
							mergePlace: lastPlace,
							...(dissolved ? { mergeSteps: steps.leftBatch() } : {}),
						});
					},
				},
				(signal) => runner.reserve(onQueued, signal, ticket),
			);
		} else {
			followed = await waitAlone(
				(signal) => runner.reserve(onQueued, signal, ticket),
				watching ? doomed : undefined,
			);
		}
		if ("doomed" in followed) {
			// Refuses the conflict with its rebase left in progress.
			await rebaseOntoBase();
			// Only reached when the rebase found no conflict after all: the
			// prediction never lets anything through, so wait for the turn.
			followed = {
				capacity: await runner.reserve(onQueued, undefined, ticket),
			};
		}
		if ("result" in followed) {
			const { result } = followed;
			worktree = await state.requireLease();
			facts.batch = result.batch;
			if (result.kind === "landed") {
				await enter("finish");
				const holder = await git.worktreeFor(base);
				await finishLanding(
					{ service, git, config, log, shell, tasks, slots, branches, timing },
					{
						current: worktree,
						head: await git.out(
							worktree.path,
							"rev-parse",
							"--short",
							result.head,
						),
						landing: holder ?? git.root,
						landed: null,
						...own,
						testTimes: [],
					},
					facts,
				);
				return;
			}
			facts.failureAttribution = result.attribution;
			facts.failedTests = result.failedTests;
			await queueFailedTests(
				{ tasks, log, journal },
				task,
				result.failedTests,
				result.attribution,
			);
			return await refuseTestsFailed(
				{ git, service, state },
				{
					task,
					branch: worktree.branch,
					base,
					cwd: worktree.path,
					command: runner.command,
					output: result.output,
					exitCode: result.exitCode,
					failing: result.failedTests,
					onto: firstOnto,
					rebasedOnto: result.rebasedOnto,
					testedHead: ownHead,
					lastBase: rebase.lastBase ?? null,
					batch: { tasks: result.batch, at: result.at },
				},
				facts,
			);
		}
		await using _capacity = followed.capacity;
		await startGate();
		worktree = await state.requireLease();
		// Set once a batch came to nothing the leader could blame on one task:
		// it gates alone from then, one at a time, as before batches.
		let alone = !batching;
		for (;;) {
			worktree = await state.requireLease();
			delete facts.failureAttribution;
			delete facts.output;
			delete facts.landed;
			delete facts.batch;
			facts.failedTests = [];

			// A retest after the base moved rebases afresh.
			if (facts.retests) {
				await enter("rebase");
			}
			const rebasedOnto = await rebaseOntoBase();

			// After the rebase, never before: a branch that passed against an older
			// trunk tells you nothing about the combination. This is the only thing
			// standing between semantic conflicts and a broken trunk, and a repo that
			// configures neither hook has chosen to go without it.
			//
			// The two hooks share one shell rather than getting a run each: the recovery
			// is the same either way, and one gate reports one failure however far down
			// it got.
			const testedHead = await git.head(worktree.path);
			const members = alone ? [] : await line.form(task, base, testedHead);
			const stack: Member[] = [
				{ task, onto: rebasedOnto, head: testedHead },
				...members,
			];
			const tip = stack[stack.length - 1]?.head ?? testedHead;
			const names = stack.map((each) => each.task);
			using _gating = line.gating(task, members);
			let checkout: Checkout | null = null;
			if (members.length > 0) {
				facts.batch = names;
				log.info(
					`${color.green("gating")} in one batch with ${members.map((each) => each.task).join(", ")}`,
				);
				try {
					checkout = await runner.checkout(worktree.path, tip, "splates-batch");
				} catch (error) {
					log.error(
						`could not check the batch's tip out, gating alone: ${error instanceof Error ? error.message : String(error)}`,
					);
					await line.dissolve(members);
					alone = true;
					continue;
				}
			}
			await using _checkout = {
				[Symbol.asyncDispose]: async () => {
					try {
						await checkout?.[Symbol.asyncDispose]();
					} catch (error) {
						log.error(
							`could not remove the batch checkout ${checkout?.path}: ${error instanceof Error ? error.message : String(error)}`,
						);
					}
				},
			};
			const cwd = checkout?.path ?? worktree.path;
			const output = outputOf("test");
			if (runner.command) {
				await enter("test", output);
			}
			let gated = await runner.run(cwd, task, {
				recent: await recentFailedFiles(journal),
				onPhases,
				output,
			});
			await state.requireLease();
			if (gated.timedOut) {
				// A gate this long has hung rather than failed: nothing to attribute,
				// and no attempt spent.
				await line.dissolve(members);
				// Back to the tested commit, dropping what the gate wrote: the branch
				// stays rebased, so the agent can run the files there.
				await git.resetHard(worktree.path, testedHead);
				fail(
					"timeout",
					[
						shown(`${gated.stdout}\n${gated.stderr}`, output),
						"",
						`\`${runner.command}\` ran past ${Duration.ms(gated.deadlineMs ?? runner.timeout.ms).human()}, its deadline at load ${(facts.gate?.load ?? 0).toFixed(1)} with ${facts.gate?.workers ?? "?"} workers, and was killed.`,
						`${base} is untouched and ${branch} is now rebased onto ${base}@${rebasedOnto.slice(0, 8)}, the commit it was tested against. No merge attempt was spent.`,
						"",
						"Merge again.",
					].join("\n"),
					{ task },
				);
			}
			// A test that keeps flaking is quarantined: a gate it alone fails lands.
			const excused =
				gated.exitCode !== 0 && !gated.timedOut ? failingCases(gated.xml) : [];
			if (
				excused.length > 0 &&
				allQuarantined(excused, await quarantinedTests(journal))
			) {
				facts.failureAttribution = "flake";
				facts.failedTests = excused;
				log.error(
					`Quarantined, so not refusing the merge: ${excused.map((test) => test.name).join(", ")}`,
				);
				gated = { ...gated, exitCode: 0 };
			}
			if (gated.exitCode !== 0) {
				const attribution = await attributeFailure({ gate: runner }, gated, {
					cwd,
					task,
					onto: rebasedOnto,
				});
				await state.requireLease();
				facts.failureAttribution = attribution.kind;
				facts.failedTests = attribution.failed.length
					? attribution.failed
					: failedTests(`${gated.stdout}\n${gated.stderr}`);
				// A flake is queued once the rerun says whether it was one.
				if (attribution.kind !== "flake") {
					await queueFailedTests(
						{ tasks, log, journal },
						task,
						facts.failedTests,
						attribution.kind,
					);
				}
				log.error(attribution.why);
				if (attribution.kind === "flake") {
					await onPhases([]);
					gated = await runner.run(cwd, task, { onPhases, output });
					if (gated.exitCode === 0) {
						// The merge lands, so the flaky test is left to a task of its own.
						await queueFailedTests(
							{ tasks, log, journal },
							task,
							facts.failedTests,
							"flake",
						);
					} else {
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
				if (gated.exitCode !== 0 && members.length > 0) {
					const next = await splitBatch(
						{ line, gate: runner, git, log, state },
						{
							cwd,
							task,
							stack,
							gated,
							kind: facts.failureAttribution,
							failed: facts.failedTests ?? [],
						},
					);
					if (next !== "refuse") {
						alone = next === "alone";
						continue;
					}
				}
			}
			await state.requireLease();
			if (gated.exitCode !== 0) {
				// The rebase already finished: keep the branch on it, so the failure
				// can be reproduced in the tree the gate saw. The reset only drops
				// what the gate wrote.
				await git.resetHard(worktree.path, testedHead);
				await refuseTestsFailed(
					{ git, service, state },
					{
						task,
						branch: worktree.branch,
						base,
						cwd: worktree.path,
						command: runner.command,
						output: `${gated.stdout}\n${gated.stderr}`,
						log: output,
						exitCode: gated.exitCode,
						failing: failingCases(gated.xml),
						onto: rebasedOnto,
						rebasedOnto,
						testedHead,
						lastBase: rebase.lastBase ?? null,
						...(members.length > 0 ? { batch: { tasks: names, at: tip } } : {}),
					},
					facts,
				);
			}

			// A hook that wrote no report, or one that does not parse, times nothing.
			const testTimes = timedTests(gated.xml);

			await enter("land");
			const result = await landTested(
				{ service, git, lock, branches, trunk },
				worktree,
				{ remote, onto: rebasedOnto, testedHead, tip },
				facts,
			);
			if (result === null) {
				await line.dissolve(members);
				facts.retests = (facts.retests ?? 0) + 1;
				worktree = await worktree.reload();
				continue;
			}
			for (const member of members) {
				line.tell(member, {
					kind: "landed",
					head: member.head,
					batch: names,
				});
			}
			await enter("finish");
			await finishLanding(
				{ service, git, config, log, shell, tasks, slots, branches, timing },
				{ ...result, testTimes },
				facts,
			);
			return;
		}
	} finally {
		await treeLock.release();
	}
}

/**
 * Puts a branch a cut-off merge left on a batch's stack back on its own
 * head, as the merge had it before it was stacked; a branch that has moved
 * since is left as it is.
 */
async function offStack(git: Git, worktree: Worktree): Promise<Worktree> {
	const stacked = worktree.state?.mergeStack;
	if (stacked === undefined) {
		return worktree;
	}
	if ((await git.head(worktree.path)) === stacked.head) {
		await git.resetHard(worktree.path, stacked.own);
	}
	return worktree.save({ mergeStack: undefined });
}
