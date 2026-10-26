import type { Logger } from "webappwiz/log";
import { Duration, sleep } from "webappwiz/time";
import type { Git } from "../git";
import type { MergeBatch, Settled } from "./batch";

/** What following came to: the lock, to lead, or a batch's result. */
export type Followed =
	| { capacity: AsyncDisposable }
	| { result: Settled }
	| { doomed: true };

/**
 * Waits for the premerge lock as a merge offered to any batch, and says
 * what came of it: the result of a batch that landed or refused the branch,
 * `{ doomed: true }` once `doomed` answers true while the branch is on no
 * stack, or the lock, which makes this merge the next leader. The branch is
 * left on `ownHead` unless a batch landed it.
 */
export async function follow(
	{
		batch,
		git,
		log,
		pollMs = 1000,
		doomed,
	}: {
		batch: MergeBatch;
		git: Git;
		log: Logger;
		pollMs?: number;
		doomed?: () => Promise<boolean>;
	},
	{
		task,
		path,
		ownHead,
		requireLease,
		onStacked,
		onUnstacked,
	}: {
		task: string;
		path: string;
		/** The branch's tip rebased on the base alone, which every stacking starts from. */
		ownHead: string;
		requireLease: () => Promise<unknown>;
		/** Called once the branch is on a batch's stack, whose gate is this merge's. */
		onStacked: () => Promise<void>;
		/** Called when a batch let the branch go, back on `ownHead`, to wait on. */
		onUnstacked: () => Promise<void>;
	},
	reserve: (signal: AbortSignal) => Promise<AsyncDisposable>,
): Promise<Followed> {
	// Each leader's invitation is answered by stacking the branch on the tip
	// it names; a batch's result gives the wait up, the ticket gone.
	const controller = new AbortController();
	let result: Settled | null = null;
	let stacked = false;
	let done = false;
	let gaveUp = false;
	const unstack = async () => {
		if (stacked) {
			stacked = false;
			await git.resetHard(path, ownHead);
			await onUnstacked();
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
				`not gating in a batch: the rebase onto its stack ${onto.slice(0, 8)} conflicted`,
			);
			return null;
		}
		stacked = true;
		await onStacked();
		return git.head(path);
	};
	const polling = (async () => {
		while (!done) {
			const found = await batch.result(task);
			if (found !== null && found.kind === "dissolved") {
				await batch.unstack(task);
				await unstack();
			} else if (found !== null) {
				result = found;
				controller.abort(new Error("the batch has finished"));
				return;
			}
			const invite = await batch.invited(task);
			if (invite !== null) {
				const head = await stack(invite.onto);
				await batch.stacked(task, invite.onto, head);
			}
			if (doomed !== undefined && !stacked && (await doomed())) {
				gaveUp = true;
				controller.abort(new Error("the branch conflicts with the base"));
				return;
			}
			await sleep(Duration.ms(pollMs));
		}
	})();
	let capacity: AsyncDisposable | null = null;
	try {
		capacity = await reserve(controller.signal);
	} catch (error) {
		if (!controller.signal.aborted) {
			done = true;
			await polling;
			throw error;
		}
	}
	done = true;
	await polling;
	if (capacity !== null) {
		// The leader says before it lets the lock go, so a result is read
		// once more with the lock had.
		const found = result ?? (await batch.result(task));
		if (found !== null && found.kind !== "dissolved") {
			await capacity[Symbol.asyncDispose]();
			capacity = null;
			result = found;
		}
	}
	if (result !== null) {
		if (result.kind === "landed") {
			await git.resetHard(path, result.head);
		} else {
			await unstack();
		}
		await batch.clear(task);
		return { result };
	}
	await unstack();
	await batch.clear(task);
	if (gaveUp) {
		if (capacity !== null) {
			await capacity[Symbol.asyncDispose]();
		}
		return { doomed: true };
	}
	if (capacity === null) {
		// Aborted by a result that then turned out dissolved: wait again.
		return follow(
			{ batch, git, log, pollMs, doomed },
			{ task, path, ownHead, requireLease, onStacked, onUnstacked },
			reserve,
		);
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
