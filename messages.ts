import { type IdProvider, UuidProvider } from "webappwiz/id";
import type { Fs, Lock } from "webappwiz/system";
import { Attachments } from "./attachments";
import { type Question, replyLine } from "./plan";

/** How long a person opening a message holds it before it lapses unsaved. */
export const EDIT_MS = 5 * 60 * 1000;

/**
 * Something a person sent a task's agent from the page: a reply to one of its
 * questions (`Q3`), or a message of its own (`M2`). Kept for as long as the
 * task is, so the page can show everything sent. Until its agent claims it,
 * it waits here, out of the plan, and can still change; claiming writes it
 * into the plan and ends that.
 */
export interface MessageState {
	task: string;
	/** `Q3` for a reply to that question, `M2` for a message of its own. */
	id: string;
	/** What a message follows up, `Q3` or `M1`; null for anything else. */
	about: string | null;
	/** The keys of the choices a reply picked. */
	choices: string[];
	/** Words, alongside the picks or instead of them. */
	text: string;
	/** Absolute paths of the files attached, in `messages/<task>/<id>/`. */
	files: string[];
	sentAt: string;
	/**
	 * While a person has it open to edit, when that hold lapses; null when
	 * nobody does. An agent claims nothing held, so it never reads a message
	 * mid-change.
	 */
	editingUntil: string | null;
	/** When its agent claimed it, writing it into the plan; null until then. */
	claimedAt: string | null;
}

/** One message sent, with what can be done to it. */
export class SentMessage {
	constructor(
		private readonly messages: Messages,
		readonly state: MessageState,
	) {}

	get isReply(): boolean {
		return this.state.id.startsWith("Q");
	}

	/** Claimed by its agent: in the plan, and no longer to change. */
	get claimed(): boolean {
		return this.state.claimedAt !== null;
	}

	/** Held by a person right now. */
	get editing(): boolean {
		return (
			this.state.editingUntil !== null &&
			Date.parse(this.state.editingUntil) > Date.now()
		);
	}

	get attachments(): Attachments {
		return this.messages.attachments(this.state.task, this.state.id);
	}

	/** Holds it for a person to edit, for `EDIT_MS` from now. */
	hold(): Promise<SentMessage> {
		return this.messages.save({
			...this.state,
			editingUntil: new Date(Date.now() + EDIT_MS).toISOString(),
		});
	}

	release(): Promise<SentMessage> {
		return this.messages.save({ ...this.state, editingUntil: null });
	}

	/** Marks it read by its agent, which is what ends any chance to edit it. */
	claim(): Promise<SentMessage> {
		return this.messages.save({
			...this.state,
			editingUntil: null,
			claimedAt: new Date().toISOString(),
		});
	}

	/** Drops it, files and all, as withdrawing one not yet claimed does. */
	async remove(): Promise<void> {
		await this.messages.delete(this.state.task, this.state.id);
		await this.attachments.clear();
	}
}

/**
 * Every message sent, one JSON file each at `.git/arbor/messages/<task>/<id>.json`,
 * its files beside it. Removing a task takes its folder with it.
 */
export class Messages {
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

	/** Runs `work` holding the lock every write to a message goes through. */
	async locked<T>(work: () => Promise<T>): Promise<T> {
		await this.lock.acquire();
		try {
			return await work();
		} finally {
			await this.lock.release();
		}
	}

	async find(task: string, id: string): Promise<SentMessage | null> {
		const state = await this.read(this.path(task, id));
		return state === null ? null : new SentMessage(this, state);
	}

	/** A task's messages, oldest first. */
	async forTask(task: string): Promise<SentMessage[]> {
		const entries = await this.fs
			.readdir(`${this.dir}/${task}`)
			.catch(() => []);
		const found: SentMessage[] = [];
		for (const entry of entries.filter((entry) => entry.endsWith(".json"))) {
			const state = await this.read(`${this.dir}/${task}/${entry}`);
			if (state) {
				found.push(new SentMessage(this, state));
			}
		}
		return found.sort((left, right) =>
			left.state.sentAt.localeCompare(right.state.sentAt),
		);
	}

	/** A task's messages its agent has yet to claim. */
	async unclaimed(task: string): Promise<SentMessage[]> {
		return (await this.forTask(task)).filter((message) => !message.claimed);
	}

	attachments(task: string, id: string): Attachments {
		return new Attachments(`${this.dir}/${task}/${id}`, this.fs, this.ids);
	}

	/** Whether `path` is a file some message holds, and not a way out of here. */
	owns(path: string): boolean {
		return new Attachments(this.dir, this.fs).owns(path);
	}

	/** @internal Writes one message. Rename makes the swap atomic for readers. */
	async save(state: MessageState): Promise<SentMessage> {
		const path = this.path(state.task, state.id);
		await this.fs.mkdir(`${this.dir}/${state.task}`);
		const tmp = `${path}.${crypto.randomUUID()}.tmp`;
		await this.fs.write(tmp, `${JSON.stringify(state, null, "\t")}\n`);
		await this.fs.rename(tmp, path);
		return new SentMessage(this, state);
	}

	/** @internal */
	async delete(task: string, id: string): Promise<void> {
		await this.fs.rm(this.path(task, id), { force: true });
	}

	private path(task: string, id: string): string {
		return `${this.dir}/${task}/${id}.json`;
	}

	private async read(path: string): Promise<MessageState | null> {
		const raw = await this.fs.read(path).catch(() => null);
		if (raw === null) {
			return null;
		}
		try {
			return JSON.parse(raw) as MessageState;
		} catch {
			return null;
		}
	}
}

/**
 * A reply as its line in the plan reads once claimed: the picks spelled out,
 * the words, then each file's path, so the line alone is the whole answer.
 */
export function replyText(asked: Question, reply: MessageState): string {
	return [replyLine(asked, reply), ...reply.files].filter(Boolean).join(" ");
}

/**
 * A message as its item in the plan reads once claimed: what it follows up,
 * the words, then each file's path on a line of its own.
 */
export function messageText(message: MessageState): string {
	const lead = message.about === null ? "" : `Re ${message.about}: `;
	return [`${lead}${message.text.trim()}`, ...message.files].join("\n");
}
