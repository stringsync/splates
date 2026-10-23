import type { Logger } from "webappwiz/log";
import type { Ps } from "webappwiz/system";
import { Duration, sleep } from "webappwiz/time";
import type { Storage } from "../storage";
import type { FailedTest } from "../tasks";
import type { FailureAttribution } from "./attribution";

/** How many merges one batch gates at most, its leader included. */
export const MERGE_BATCH_CAP = 4;
/** How long a leader waits for a follower it invited to stack its branch. */
export const STACK_REPLY_MS = 30_000;

/**
 * How merges waiting for the premerge lock gate as one batch: each posts an
 * offer in the project's `merge-batch` collection while it waits, the one
 * that takes the lock leads, inviting the others in the order they came to
 * stack their branches on its tip, and each follower reads its result there
 * once the batch's gate has run. Every record is the task's own, named for
 * it, so two processes never write one.
 */
export class MergeBatch {
	private readonly pollMs: number;
	private readonly replyMs: number;
	private readonly cap: number;
	/** Followers this leader asked that did not stack, not asked again. */
	private readonly declined = new Set<string>();

	constructor(
		private readonly storage: Storage,
		private readonly ps: Ps,
		private readonly log: Logger,
		opts: MergeBatchOptions = {},
	) {
		this.pollMs = opts.pollMs ?? 1000;
		this.replyMs = opts.replyMs ?? STACK_REPLY_MS;
		this.cap = opts.cap ?? MERGE_BATCH_CAP;
	}

	private get records() {
		return this.storage.collection("merge-batch");
	}

	/** Offers `task`'s merge onto `base` to whichever merge leads next. */
	async offer(task: string, base: string): Promise<void> {
		await this.clear(task);
		await this.write(`offer:${task}`, {
			task,
			pid: this.ps.pid,
			hostname: this.ps.hostname,
			base,
			since: new Date().toISOString(),
		} satisfies Offer);
	}

	/** Takes `task` out of any batch, leaving no record of it. */
	async clear(task: string): Promise<void> {
		for (const kind of ["offer", "invite", "stacked", "result"]) {
			await this.records.remove(`${kind}:${task}`);
		}
	}

	/** The invitation `task` has yet to answer, if any. */
	async invited(task: string): Promise<Invite | null> {
		const invite = await this.read<Invite>(`invite:${task}`);
		if (invite === null) {
			return null;
		}
		const answered = await this.read<Stacked>(`stacked:${task}`);
		return answered?.onto === invite.onto ? null : invite;
	}

	/** Answers an invitation: the branch's head on `onto`, or null for a conflict. */
	async stacked(
		task: string,
		onto: string,
		head: string | null,
	): Promise<void> {
		await this.write(`stacked:${task}`, { onto, head } satisfies Stacked);
	}

	/** What the batch came to for `task`, once its leader has said. */
	async result(task: string): Promise<BatchResult | null> {
		return this.read<BatchResult>(`result:${task}`);
	}

	/**
	 * Forms `leader`'s batch: invites the merges waiting to land on `base`,
	 * oldest first and up to the cap, each onto the tip the one before it
	 * made, and returns those that stacked. A follower that declines, or
	 * does not answer in time, is left out of this leader's batches.
	 */
	async form(leader: string, base: string, tip: string): Promise<Member[]> {
		const members: Member[] = [];
		for (const offer of await this.waiting(base, leader)) {
			if (members.length + 1 >= this.cap) {
				break;
			}
			const onto = members.at(-1)?.head ?? tip;
			await this.records.remove(`result:${offer.task}`);
			await this.write(`invite:${offer.task}`, {
				leader,
				onto,
			} satisfies Invite);
			const head = await this.awaitStacked(offer.task, onto);
			if (head === null) {
				this.declined.add(offer.task);
				await this.records.remove(`invite:${offer.task}`);
				continue;
			}
			members.push({ task: offer.task, onto, head });
		}
		return members;
	}

	/** Leaves `task` out of this leader's later batches, as a culprit is. */
	exclude(task: string): void {
		this.declined.add(task);
	}

	/** Drops `task`'s answer and result, as a follower a batch let go does. */
	async unstack(task: string): Promise<void> {
		for (const kind of ["invite", "stacked", "result"]) {
			await this.records.remove(`${kind}:${task}`);
		}
	}

	/** Tells `member` what its batch came to. */
	async tell(member: Member, result: BatchResult): Promise<void> {
		await this.write(`result:${member.task}`, result);
	}

	/** Sends every member of `members` on its way alone, back on its own head. */
	async dissolve(members: Member[]): Promise<void> {
		for (const member of members) {
			await this.tell(member, { kind: "dissolved" });
		}
	}

	/**
	 * The live offers for `base`, oldest first, the leader's own and those it
	 * has given up on left out; an offer whose process is gone is dropped.
	 */
	private async waiting(base: string, leader: string): Promise<Offer[]> {
		const offers: Offer[] = [];
		for (const name of await this.records.list()) {
			if (!name.startsWith("offer:")) {
				continue;
			}
			const offer = await this.read<Offer>(name);
			if (offer === null) {
				continue;
			}
			if (offer.hostname === this.ps.hostname && !this.ps.alive(offer.pid)) {
				this.log.error(
					`dropping the merge offer of ${offer.task}: pid ${offer.pid} is gone`,
				);
				await this.clear(offer.task);
				continue;
			}
			if (
				offer.base !== base ||
				offer.task === leader ||
				this.declined.has(offer.task)
			) {
				continue;
			}
			offers.push(offer);
		}
		return offers.sort((one, other) => one.since.localeCompare(other.since));
	}

	/** The head `task` stacked on `onto`, or null once it declined or ran out of time. */
	private async awaitStacked(
		task: string,
		onto: string,
	): Promise<string | null> {
		const until = Date.now() + this.replyMs;
		for (;;) {
			const stacked = await this.read<Stacked>(`stacked:${task}`);
			if (stacked?.onto === onto) {
				return stacked.head;
			}
			if (Date.now() >= until) {
				this.log.error(
					`${task} did not stack on ${onto.slice(0, 8)} within ${Duration.ms(this.replyMs).human()}: gating without it`,
				);
				return null;
			}
			await sleep(Duration.ms(this.pollMs));
		}
	}

	private async read<T>(name: string): Promise<T | null> {
		const raw = await this.records.read(name);
		if (raw === null) {
			return null;
		}
		try {
			return JSON.parse(raw) as T;
		} catch {
			return null;
		}
	}

	private write(name: string, value: unknown): Promise<void> {
		return this.records.write(name, JSON.stringify(value));
	}
}

export interface MergeBatchOptions {
	/** How often a follower looks for an invitation or result. */
	pollMs?: number;
	/** How long a leader waits for an invited follower to stack. */
	replyMs?: number;
	/** How many merges a batch gates at most, the leader included. */
	cap?: number;
}

/** A merge waiting for the premerge lock that a leader may take into its batch. */
export interface Offer {
	task: string;
	pid: number;
	hostname: string;
	/** The branch it lands on; a batch holds one base's merges only. */
	base: string;
	/** When it began waiting, which orders the batch first come, first served. */
	since: string;
}

/** A leader's ask of a follower: put your branch on `onto`. */
export interface Invite {
	leader: string;
	/** The stack's tip to rebase onto. */
	onto: string;
}

/** A follower stacked on a leader's `onto`, or declined it. */
export interface Stacked {
	onto: string;
	/** The branch's tip once on `onto`; null for a rebase that conflicted. */
	head: string | null;
}

/** A follower's head, stacked on the batch's tip before it. */
export interface Member {
	task: string;
	onto: string;
	head: string;
}

/** What a batch came to for one of its followers. */
export type BatchResult =
	| { kind: "landed"; head: string; batch: string[] }
	| {
			kind: "failed";
			attribution: FailureAttribution;
			failedTests: FailedTest[];
			/** The end of what the batch's gate printed. */
			output: string;
			exitCode: number;
			/** The commit the follower's branch was stacked on when it was gated. */
			rebasedOnto: string;
			/** The stack's commit holding the follower's commits, to reproduce on. */
			at: string;
			batch: string[];
	  }
	| { kind: "dissolved" };

/** A batch's result that ends the follower's merge: landed, or refused. */
export type Settled = Exclude<BatchResult, { kind: "dissolved" }>;
