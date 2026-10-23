import type { Logger } from "webappwiz/log";
import { Duration, sleep } from "webappwiz/time";
import type { Git } from "../git";
import type { MergeBatch, Settled } from "./batch";

/** What following came to: the lock, to lead, or a batch's result. */
export type Followed = { capacity: AsyncDisposable } | { result: Settled };

/**
 * Waits for the premerge lock as a merge offered to any batch: answers each
 * leader's invitation by stacking the branch on the tip it names, and
 * returns the batch's result once one lands or refuses it, giving the wait
 * up, or the lock once it is had with no result, which makes this merge
 * the next leader. Either way the branch is left on `ownHead` unless the
 * batch landed it.
 */
export async function follow(
	{
		batch,
		git,
		log,
		pollMs = 1000,
	}: { batch: MergeBatch; git: Git; log: Logger; pollMs?: number },
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
	const controller = new AbortController();
	let result: Settled | null = null;
	let stacked = false;
	let done = false;
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
	if (capacity === null) {
		// Aborted by a result that then turned out dissolved: wait again.
		return follow(
			{ batch, git, log, pollMs },
			{ task, path, ownHead, requireLease, onStacked, onUnstacked },
			reserve,
		);
	}
	return { capacity };
}
