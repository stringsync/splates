import { color, type Logger } from "core/log";
import type { Git } from "../git";
import type { MergeLine, Settled } from "./line";

/** What following came to: the lock, to lead, or a batch's result. */
export type Followed =
	| { capacity: AsyncDisposable }
	| { result: Settled }
	| { doomed: true };

/**
 * Waits for the premerge lock as a merge in `line`, and says what came of
 * it: the result of a batch that landed or refused the branch,
 * `{ doomed: true }` once `doomed` answers true while the branch is on no
 * stack, or the lock, which makes this merge the next leader. The branch is
 * left on `ownHead` unless a batch landed it.
 */
export async function follow(
	{
		line,
		git,
		log,
		pollMs = 1000,
		doomed,
	}: {
		line: MergeLine;
		git: Git;
		log: Logger;
		pollMs?: number;
		doomed?: () => Promise<boolean>;
	},
	{
		task,
		base,
		path,
		ownHead,
		requireLease,
		onStacked,
		onUnstacked,
	}: {
		task: string;
		/** The branch it lands on; a batch holds one base's merges only. */
		base: string;
		path: string;
		/** The branch's tip rebased on the base alone, which every stacking starts from. */
		ownHead: string;
		requireLease: () => Promise<unknown>;
		/** Called once the branch is on a batch's stack at `head`, whose gate is this merge's. */
		onStacked: (head: string) => Promise<void>;
		/**
		 * Called when a batch let the branch go, back on `ownHead`: to wait
		 * on once the batch `dissolved`, or refused by its result otherwise.
		 */
		onUnstacked: (dissolved: boolean) => Promise<void>;
	},
	reserve: (signal: AbortSignal) => Promise<AsyncDisposable>,
): Promise<Followed> {
	// A leader stacks the branch on its tip by calling `stack`; a batch's
	// result gives the wait up, the ticket gone.
	const controller = new AbortController();
	let result = null as Settled | null;
	let stacked = false;
	let gaveUp = false;
	const unstack = async (dissolved = true) => {
		if (stacked) {
			stacked = false;
			await git.resetHard(path, ownHead);
			await onUnstacked(dissolved);
		}
	};
	const stack = async (onto: string): Promise<string | null> => {
		await requireLease();
		await git.resetHard(path, ownHead);
		const rebased = await git.rebase(path, onto);
		if (rebased.code !== 0) {
			await git.run(path, "rebase", "--abort");
			await git.resetHard(path, ownHead);
			log.info(
				`${color.yellow("not gating")} in a batch: the rebase onto its stack ${onto.slice(0, 8)} conflicted`,
			);
			return null;
		}
		const head = await git.head(path);
		stacked = true;
		await onStacked(head);
		return head;
	};
	using offer = line.join(task, base, stack, () => unstack());
	void offer.settled.then((found) => {
		result = found;
		controller.abort(new Error("the batch has finished"));
	});
	let asking = false;
	const poll =
		doomed === undefined
			? undefined
			: setInterval(() => {
					if (asking || stacked || offer.stacked()) {
						return;
					}
					asking = true;
					void doomed()
						.then((yes) => {
							if (yes && !stacked && !offer.stacked()) {
								gaveUp = true;
								controller.abort(
									new Error("the branch conflicts with the base"),
								);
							}
						})
						.finally(() => {
							asking = false;
						});
				}, pollMs);
	let capacity: AsyncDisposable | null = null;
	try {
		capacity = await reserve(controller.signal);
	} catch (error) {
		if (!controller.signal.aborted) {
			throw error;
		}
	} finally {
		clearInterval(poll);
	}
	// Leading now, or done: no leader may stack the branch from here.
	line.leave(task);
	if (result !== null) {
		// The leader says before it lets the lock go, so a result is had
		// before the lock is.
		if (capacity !== null) {
			await capacity[Symbol.asyncDispose]();
		}
		const settled: Settled = result;
		if (settled.kind === "landed") {
			stacked = false;
			await git.resetHard(path, settled.head);
		} else {
			await unstack(false);
		}
		return { result: settled };
	}
	// A leader that stopped without a word leaves the branch on its stack.
	await unstack();
	if (gaveUp || capacity === null) {
		if (capacity !== null) {
			await capacity[Symbol.asyncDispose]();
		}
		return { doomed: true };
	}
	return { capacity };
}

/**
 * Waits for the premerge lock as a merge offered to no batch. `doomed`,
 * asked every `pollMs`, ends the wait with `{ doomed: true }` once it
 * answers true.
 */
export async function waitAlone(
	reserve: (signal: AbortSignal) => Promise<AsyncDisposable>,
	doomed?: () => Promise<boolean>,
	pollMs = 1000,
): Promise<Followed> {
	const waiting = new AbortController();
	const poll = setInterval(() => {
		if (doomed) {
			void doomed().then((yes) => {
				if (yes) {
					waiting.abort(new Error("the branch conflicts with the base"));
				}
			});
		}
	}, pollMs);
	try {
		return { capacity: await reserve(waiting.signal) };
	} catch (error) {
		if (!waiting.signal.aborted) {
			throw error;
		}
		return { doomed: true };
	} finally {
		clearInterval(poll);
	}
}

/**
 * Asks whether `base`, once it moves past `seen`, conflicts with the
 * branch's tip `head`: true only for a merge that would conflict, so a
 * wait it ends never lets anything through.
 */
export function conflictsOnBase(
	git: Git,
	base: string,
	seen: string | null,
	head: string,
): () => Promise<boolean> {
	let seenBase = seen;
	return async () => {
		const tip = await git.run(git.root, "rev-parse", "--verify", base);
		if (tip.code !== 0 || tip.stdout === seenBase) {
			return false;
		}
		seenBase = tip.stdout;
		const merged = await git.run(
			git.root,
			"merge-tree",
			"--write-tree",
			tip.stdout,
			head,
		);
		return merged.code === 1;
	};
}
