import type { Logger } from "webappwiz/log";
import type { Fs, Lock } from "webappwiz/system";
import { type Clock, SystemClock } from "webappwiz/time";
import type { Tasks } from "../board";
import type { Config } from "../config";
import { fail } from "../exit";
import type { Git } from "../git";
import type { Slots } from "../ports";
import type { Facts, Journal } from "../records";
import type { PlacedLock } from "../server/shared";
import type { LivePhase, MergeStep, WorktreeService } from "../tasks";
import type { Shell } from "../terminal";
import { attributeFailure } from "./attribution";
import { type Member, MergeBatch } from "./batch";
import type { TaskBranches } from "./branches";
import { clearGate } from "./clear-gate";
import { GateTrail } from "./cores";
import { finishLanding } from "./finish";
import { conflictsOnBase, type Followed, follow, waitAlone } from "./follow";
import { type Checkout, MergeGate } from "./gate";
import { landTested } from "./landing";
import { MergeState } from "./merge-state";
import { refuseFailedChecks } from "./pre-lock";
import { refuseUnready } from "./preflight";
import { queueFailedTests } from "./queue-failures";
import { BaseRebase } from "./rebase";
import { recentFailedFiles } from "./recent-failures";
import { refuseTestsFailed, tail } from "./refusal";
import { splitBatch } from "./split";
import { MergeSteps } from "./steps";
import { failedTests, failingCases, timedTests } from "./test-report";
import { MergeTiming } from "./timing";
import type { TrunkLanding } from "./trunk";

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
 *
 * Merges waiting for the premerge lock at once gate as one batch: the one
 * that takes the lock stacks the others' branches on its own, gates the
 * stack's tip once, and lands them all; a failing batch is split by whose
 * commits the failing tests first fail with (see `MergeBatch`).
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
		premerge,
		gateTimeoutMs,
		branches,
		trunk,
		batch = new MergeBatch(service.storage, service.ps, log),
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
		/** The machine's premerge lock, so one gate runs at a time. */
		premerge: PlacedLock;
		/** How long the gate may run before it is killed; `PREMERGE_TIMEOUT_MS` for none. */
		gateTimeoutMs?: number;
		branches: TaskBranches;
		trunk: TrunkLanding;
		/** Where this merge forms or joins a batch with the others waiting. */
		batch?: MergeBatch;
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

	const base = worktree.base;
	facts.base = base;
	facts.attemptsLeft = config.mergeRetryCount - worktree.mergeAttempts;
	facts.failedTests = [];
	facts.began = null;
	delete facts.failureAttribution;
	delete facts.output;
	await refuseUnready({ git, fs, config, log }, worktree);
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
	);
	// Working until landing holds the lock: waiting and testing must not
	// leave a dead merge's `merging` status showing another landing. The
	// page reads `gate` and `mergeSince` meanwhile, for as long as this merge
	// holds the lease, and `mergeSteps` to show it moving.
	const steps = new MergeSteps(clock);
	worktree = await worktree.take({
		status: "working",
		mergeSince: new Date().toISOString(),
		mergeSteps: steps.enter("rebase"),
		...(runner.command ? { gate: "queued" as const } : {}),
	});
	const enter = async (step: MergeStep) => {
		worktree = await worktree.save({ mergeSteps: steps.enter(step) });
	};
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
	const treeLock = service.storage.lock(`merge-trees/${task}.lock`);
	await treeLock.acquire();
	try {
		worktree = await state.requireLease();
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
		const onQueued = async (place: number) => {
			if (!queuedBefore) {
				queuedBefore = true;
				facts.began = (await journal?.begin("merge queued", task, {})) ?? null;
			}
			lastPlace = place;
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
					mergeSteps: steps.enter("test"),
				});
			}
			if (started) {
				return;
			}
			started = true;
			const queued = facts.began ?? null;
			const begun = await journal?.begin("merge start", task, {
				began: queued,
			});
			facts.began = queued ?? begun ?? null;
		};
		if (runner.command && runner.preLock) {
			await enter("check");
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
				},
				facts,
			);
		}
		// Only a gated merge landing here batches: with a central remote each
		// task pushes its own tested branch for the server to land.
		const batching = remote === null && runner.command !== "";
		if (batching) {
			await batch.offer(task, base);
		}
		// While waiting, a base that moved under the branch and now conflicts
		// with it ends the wait: the rebase after refuses it as it would
		// have, without the line. Never lets anything through.
		const doomed = conflictsOnBase(git, base, firstOnto, ownHead);
		const watching = remote === null && runner.command !== "";
		let followed: Followed;
		if (batching) {
			followed = await follow(
				{ batch, git, log, doomed: watching ? doomed : undefined },
				{
					task,
					path: worktree.path,
					ownHead,
					requireLease: () => state.requireLease(),
					onStacked: startGate,
					onUnstacked: async () => {
						worktree = await worktree.save({
							gate: "queued",
							mergePlace: lastPlace,
						});
					},
				},
				(signal) => runner.reserve(onQueued, signal),
			);
		} else {
			followed = await waitAlone(
				(signal) => runner.reserve(onQueued, signal),
				watching ? doomed : undefined,
			);
		}
		if ("doomed" in followed) {
			// Refuses the conflict with its rebase left in progress.
			await rebaseOntoBase();
			// Only reached when the rebase found no conflict after all: the
			// prediction never lets anything through, so wait for the turn.
			await batch.clear(task);
			followed = { capacity: await runner.reserve(onQueued) };
		}
		if ("result" in followed) {
			const { result } = followed;
			worktree = await state.requireLease();
			facts.batch = result.batch;
			if (result.kind === "landed") {
				await enter("finish");
				const holder = await git.worktreeFor(base);
				await finishLanding(
					{ service, git, config, log, tasks, slots, branches, timing },
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
			const members = alone ? [] : await batch.form(task, base, testedHead);
			const stack: Member[] = [
				{ task, onto: rebasedOnto, head: testedHead },
				...members,
			];
			const tip = stack[stack.length - 1]?.head ?? testedHead;
			const names = stack.map((each) => each.task);
			let checkout: Checkout | null = null;
			if (members.length > 0) {
				facts.batch = names;
				log.info(
					`gating in one batch with ${members.map((each) => each.task).join(", ")}`,
				);
				try {
					checkout = await runner.checkout(worktree.path, tip, "splates-batch");
				} catch (error) {
					log.error(
						`could not check the batch's tip out, gating alone: ${error instanceof Error ? error.message : String(error)}`,
					);
					await batch.dissolve(members);
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
			if (runner.command) {
				await enter("test");
			}
			let gated = await runner.run(cwd, task, {
				recent: await recentFailedFiles(journal),
				onPhases,
			});
			await state.requireLease();
			if (gated.timedOut) {
				// A gate this long has hung rather than failed: nothing to attribute,
				// and no attempt spent.
				await batch.dissolve(members);
				// Back to the tested commit, dropping what the gate wrote: the branch
				// stays rebased, so the agent can run the files there.
				await git.resetHard(worktree.path, testedHead);
				fail(
					"timeout",
					[
						tail(`${gated.stdout}\n${gated.stderr}`),
						"",
						`\`${runner.command}\` ran past ${runner.timeout.human()} and was killed.`,
						`${base} is untouched and ${branch} is now rebased onto ${base}@${rebasedOnto.slice(0, 8)}, the commit it was tested against. No merge attempt was spent.`,
						"",
						"Merge again.",
					].join("\n"),
					{ task },
				);
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
				await queueFailedTests(
					{ tasks, log, journal },
					task,
					facts.failedTests,
					attribution.kind,
				);
				log.error(attribution.why);
				if (attribution.kind === "flake") {
					await onPhases([]);
					gated = await runner.run(cwd, task, { onPhases });
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
				if (gated.exitCode !== 0 && members.length > 0) {
					const next = await splitBatch(
						{ batch, gate: runner, git, log, state },
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
				await batch.dissolve(members);
				facts.retests = (facts.retests ?? 0) + 1;
				worktree = await worktree.reload();
				continue;
			}
			for (const member of members) {
				await batch.tell(member, {
					kind: "landed",
					head: member.head,
					batch: names,
				});
			}
			await enter("finish");
			await finishLanding(
				{ service, git, config, log, tasks, slots, branches, timing },
				{ ...result, testTimes },
				facts,
			);
			return;
		}
	} finally {
		await treeLock.release();
	}
}
