import { Dispatcher, type Eventful } from "webappwiz/events";

/** Says which draft was written, by its key. */
export type DraftsEvents = { written: string };

/** Where every draft is kept, each under its own key after this. */
const PREFIX = "arbor.draft.";

/**
 * What the person typed for a conversation and has not sent, kept in
 * `storage` so switching to another conversation, another page or reloading
 * never loses it. One per key: a conversation's id, or what `newDraft` names.
 */
// scry-ignore resources-are-disposable: it holds nothing but its listeners, which unlisten themselves
export class Drafts implements Eventful<DraftsEvents> {
	private readonly dispatcher = new Dispatcher<DraftsEvents>();
	readonly events = this.dispatcher.events;
	/** Every draft this page wrote, for when `storage` refuses to keep one. */
	private readonly kept = new Map<string, string>();

	constructor(private readonly storage: Storage) {}

	/** The draft under `key`, or empty when there is none. */
	read(key: string): string {
		try {
			return this.storage.getItem(PREFIX + key) ?? this.kept.get(key) ?? "";
		} catch {
			return this.kept.get(key) ?? "";
		}
	}

	/** Keeps `text` under `key`; an empty one drops the draft. */
	write(key: string, text: string): void {
		this.store(key, text);
		this.dispatcher.dispatch("written", key);
	}

	private store(key: string, text: string): void {
		if (text === "") {
			this.kept.delete(key);
		} else {
			this.kept.set(key, text);
		}
		try {
			if (text === "") {
				this.storage.removeItem(PREFIX + key);
			} else {
				this.storage.setItem(PREFIX + key, text);
			}
		} catch {
			// Storage full or refused, as in a private window: the draft lives
			// as long as the page does.
		}
	}
}

/**
 * The key of the draft for a conversation not started yet, one per project
 * (every project's page is on the same origin, so shares one storage), and
 * one more per task for one to start in that task's tree.
 */
export function newDraft(
	project: string | null,
	task: string | null = null,
): string {
	return task === null
		? `new:${project ?? ""}`
		: `new:${project ?? ""}:${task}`;
}
