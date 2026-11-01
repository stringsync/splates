import type { Logger } from "core/log";
import type { FailedTest } from "../tasks";
import type { FailureAttribution } from "./attribution";

/** How many merges one batch gates at most, its leader included. */
export const MERGE_BATCH_CAP = 4;

/**
 * Puts a waiting merge's branch on `onto`, the tip of the stack before it,
 * and says its head there; null for a rebase that conflicted, which leaves
 * the branch on its own head.
 */
export type Stack = (onto: string) => Promise<string | null>;

/**
 * The merges of one project waiting for the premerge lock in this process,
 * which the merge holding it may gate with its own as one batch. Every
 * `splates merge` the server runs is in its one process, so a leader stacks
 * each follower by calling it, rather than by records it polls for.
 */
export class MergeLine {
	private static readonly lines = new Map<string, MergeLine>();

	/**
	 * The line of the project at `root`, shared by every merge in this
	 * process; `log` says what stacking a follower ran into.
	 */
	static of(root: string, log?: Logger): MergeLine {
		let line = MergeLine.lines.get(root);
		if (line === undefined) {
			line = new MergeLine(log ?? SILENT);
			MergeLine.lines.set(root, line);
		} else if (log !== undefined) {
			line.log = log;
		}
		return line;
	}

	private readonly waiting = new Map<string, Waiter>();
	/** How many merges have joined, which orders them first come, first served. */
	private joined = 0;
	/** Each leader's followers on its stack, kept by `gating`. */
	private readonly stacks = new Map<string, string[]>();
	/** Followers each leader has given up on, not stacked by it again. */
	private readonly declined = new Map<string, Set<string>>();

	constructor(
		private log: Logger,
		private readonly cap = MERGE_BATCH_CAP,
	) {}

	/**
	 * Offers `task`'s merge onto `base` to whichever merge leads next, until
	 * the returned offer is disposed of: `settled` resolves once a batch
	 * landed or refused it, and `dissolved` is called each time one let it
	 * go, back on its own head.
	 */
	join(
		task: string,
		base: string,
		stack: Stack,
		dissolved: () => Promise<void>,
	): Offer {
		this.leave(task);
		let settle: (result: Settled) => void = () => {};
		const settled = new Promise<Settled>((resolve) => {
			settle = resolve;
		});
		const waiter: Waiter = {
			task,
			base,
			since: this.joined++,
			stack,
			dissolved,
			settle,
			stacked: false,
			done: false,
		};
		this.waiting.set(task, waiter);
		return {
			settled,
			stacked: () => waiter.stacked,
			[Symbol.dispose]: () => {
				if (this.waiting.get(task) === waiter) {
					this.waiting.delete(task);
				}
			},
		};
	}

	/** Takes `task` out of the line, as a merge that now leads does. */
	leave(task: string): void {
		this.waiting.delete(task);
		this.declined.delete(task);
	}

	/** Whether `task` is waiting in the line. */
	has(task: string): boolean {
		return this.waiting.has(task);
	}

	/**
	 * Forms `leader`'s batch: stacks the merges waiting to land on `base`,
	 * oldest first and up to the cap, each onto the tip the one before it
	 * made, and returns those that stacked. One that conflicts is left out of
	 * this leader's batches.
	 */
	async form(leader: string, base: string, tip: string): Promise<Member[]> {
		const members: Member[] = [];
		const declined = this.declinedBy(leader);
		const waiting = [...this.waiting.values()]
			.filter(
				(each) =>
					each.base === base &&
					each.task !== leader &&
					!each.stacked &&
					!each.done &&
					!declined.has(each.task),
			)
			.sort((one, other) => one.since - other.since);
		for (const waiter of waiting) {
			if (members.length + 1 >= this.cap) {
				break;
			}
			const onto = members.at(-1)?.head ?? tip;
			let head: string | null;
			try {
				head = await waiter.stack(onto);
			} catch (error) {
				this.log.error(
					`could not stack ${waiter.task} on ${onto.slice(0, 8)}, gating without it: ${error instanceof Error ? error.message : String(error)}`,
				);
				head = null;
			}
			if (head === null) {
				declined.add(waiter.task);
				continue;
			}
			waiter.stacked = true;
			members.push({ task: waiter.task, onto, head });
		}
		return members;
	}

	/** Leaves `task` out of `leader`'s later batches, as a culprit is. */
	exclude(leader: string, task: string): void {
		this.declinedBy(leader).add(task);
	}

	/** Tells `member` what its batch came to, which ends its merge. */
	tell(member: Member, result: Settled): void {
		const waiter = this.waiting.get(member.task);
		if (waiter === undefined || waiter.done) {
			return;
		}
		waiter.done = true;
		waiter.stacked = false;
		waiter.settle(result);
	}

	/** Sends every member of `members` back to waiting alone, on its own head. */
	async dissolve(members: Member[]): Promise<void> {
		for (const member of members) {
			const waiter = this.waiting.get(member.task);
			if (waiter === undefined || waiter.done || !waiter.stacked) {
				continue;
			}
			waiter.stacked = false;
			await waiter.dissolved();
		}
	}

	/** The batches gating now, each leader first. */
	groups(): string[][] {
		return [...this.stacks].map(([leader, members]) => [leader, ...members]);
	}

	/** Says `leader` gates `members` now, until the returned handle is disposed of. */
	gating(leader: string, members: Member[]): Disposable {
		if (members.length > 0) {
			this.stacks.set(
				leader,
				members.map((each) => each.task),
			);
		}
		return {
			[Symbol.dispose]: () => {
				this.stacks.delete(leader);
			},
		};
	}

	private declinedBy(leader: string): Set<string> {
		let declined = this.declined.get(leader);
		if (declined === undefined) {
			declined = new Set();
			this.declined.set(leader, declined);
		}
		return declined;
	}
}

const SILENT: Logger = { info: () => {}, error: () => {} };

/** A merge waiting in the line. */
interface Waiter {
	task: string;
	base: string;
	/** When it joined, which orders the batch first come, first served. */
	since: number;
	stack: Stack;
	dissolved: () => Promise<void>;
	settle: (result: Settled) => void;
	/** On a leader's stack now. */
	stacked: boolean;
	/** Told its result. */
	done: boolean;
}

/** A merge's place in the line, given up when disposed of. */
export interface Offer extends Disposable {
	/** What a batch came to for it, once one landed or refused it. */
	settled: Promise<Settled>;
	/** Whether it is on a leader's stack now. */
	stacked(): boolean;
}

/** A follower's head, stacked on the batch's tip before it. */
export interface Member {
	task: string;
	onto: string;
	head: string;
}

/** What a batch came to for one of its followers: landed, or refused. */
export type Settled =
	| { kind: "landed"; head: string; batch: string[] }
	| {
			kind: "failed";
			attribution: FailureAttribution;
			failedTests: FailedTest[];
			/** What the batch gate printed. */
			output: string;
			exitCode: number;
			/** The commit the follower's branch was stacked on when it was gated. */
			rebasedOnto: string;
			/** The stack's commit holding the follower's commits, to reproduce on. */
			at: string;
			batch: string[];
	  };
