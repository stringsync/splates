import { type IdProvider, UuidProvider } from "webappwiz/id";
import type { Fs, Lock } from "webappwiz/system";
import { Attachments } from "./attachments";
import { type Question, replyLine } from "./plan";

/** How long a person opening a reply holds it before it lapses unsaved. */
export const EDIT_MS = 5 * 60 * 1000;

/**
 * A reply a person gave that its agent has not read yet. It waits here, out
 * of the plan, so the agent sees nothing half-written: the agent claims it to
 * read it, which writes it into the plan and ends any chance to edit it.
 */
export interface ReplyState {
	task: string;
	/** `Q2`. */
	question: string;
	/** The keys of the choices picked. */
	choices: string[];
	/** Words, alongside the picks or instead of them. */
	text: string;
	/** Absolute paths of the files attached, in `replies/<task>/Q2/`. */
	files: string[];
	repliedAt: string;
	/**
	 * While a person has it open to edit, when that hold lapses; null when
	 * nobody does. An agent reads nothing held, so it never sees a reply
	 * mid-change.
	 */
	editingUntil: string | null;
}

/** One reply waiting to be read, with what can be done to it. */
export class PendingReply {
	constructor(
		private readonly replies: Replies,
		readonly state: ReplyState,
	) {}

	/** Held by a person right now. */
	get editing(): boolean {
		return (
			this.state.editingUntil !== null &&
			Date.parse(this.state.editingUntil) > Date.now()
		);
	}

	get attachments(): Attachments {
		return this.replies.attachments(this.state.task, this.state.question);
	}

	/** Holds it for a person to edit, for `EDIT_MS` from now. */
	hold(): Promise<PendingReply> {
		return this.replies.save({
			...this.state,
			editingUntil: new Date(Date.now() + EDIT_MS).toISOString(),
		});
	}

	release(): Promise<PendingReply> {
		return this.replies.save({ ...this.state, editingUntil: null });
	}

	/** Drops the record. Its files go too unless `keepFiles`, as a claim wants. */
	async remove({ keepFiles = false } = {}): Promise<void> {
		await this.replies.delete(this.state.task, this.state.question);
		if (!keepFiles) {
			await this.attachments.clear();
		}
	}
}

/**
 * Every reply waiting to be read, one JSON file each at
 * `.git/arbor/replies/<task>/<question>.json`, its files beside it. Removing a
 * task takes its folder with it.
 */
export class Replies {
	private readonly ids: IdProvider;

	constructor(
		readonly dir: string,
		/** Held across a read and the write it decides, so a claim and an edit never cross. */
		private readonly lock: Lock,
		private readonly fs: Fs,
		{ ids = new UuidProvider() }: { ids?: IdProvider } = {},
	) {
		this.ids = ids;
	}

	/** Runs `work` holding the lock every write to a reply goes through. */
	async locked<T>(work: () => Promise<T>): Promise<T> {
		await this.lock.acquire();
		try {
			return await work();
		} finally {
			await this.lock.release();
		}
	}

	async find(task: string, question: string): Promise<PendingReply | null> {
		const state = await this.read(this.path(task, question));
		return state === null ? null : new PendingReply(this, state);
	}

	/** A task's waiting replies, by question number. */
	async forTask(task: string): Promise<PendingReply[]> {
		const entries = await this.fs
			.readdir(`${this.dir}/${task}`)
			.catch(() => []);
		const found: PendingReply[] = [];
		for (const entry of entries.filter((entry) => entry.endsWith(".json"))) {
			const state = await this.read(`${this.dir}/${task}/${entry}`);
			if (state) {
				found.push(new PendingReply(this, state));
			}
		}
		return found.sort(
			(left, right) =>
				number(left.state.question) - number(right.state.question),
		);
	}

	attachments(task: string, question: string): Attachments {
		return new Attachments(
			`${this.dir}/${task}/${question}`,
			this.fs,
			this.ids,
		);
	}

	/** Whether `path` is a file some reply holds, and not a way out of here. */
	owns(path: string): boolean {
		return new Attachments(this.dir, this.fs).owns(path);
	}

	/** @internal Writes one reply. Rename makes the swap atomic for readers. */
	async save(state: ReplyState): Promise<PendingReply> {
		const path = this.path(state.task, state.question);
		await this.fs.mkdir(`${this.dir}/${state.task}`);
		const tmp = `${path}.${crypto.randomUUID()}.tmp`;
		await this.fs.write(tmp, `${JSON.stringify(state, null, "\t")}\n`);
		await this.fs.rename(tmp, path);
		return new PendingReply(this, state);
	}

	/** @internal */
	async delete(task: string, question: string): Promise<void> {
		await this.fs.rm(this.path(task, question), { force: true });
	}

	private path(task: string, question: string): string {
		return `${this.dir}/${task}/${question}.json`;
	}

	private async read(path: string): Promise<ReplyState | null> {
		const raw = await this.fs.read(path).catch(() => null);
		if (raw === null) {
			return null;
		}
		try {
			return JSON.parse(raw) as ReplyState;
		} catch {
			return null;
		}
	}
}

function number(question: string): number {
	return Number(question.slice(1));
}

/**
 * A reply as its line in the plan reads once claimed: the picks spelled out,
 * the words, then each file's path, so the line alone is the whole answer.
 */
export function replyText(asked: Question, reply: ReplyState): string {
	return [replyLine(asked, reply), ...reply.files].filter(Boolean).join(" ");
}
