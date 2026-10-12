import { Dispatcher, type Eventful } from "webappwiz/events";

/** Says which draft was written, by its key. */
export type DraftsEvents = { written: string };

/** Where every draft is kept, each under its own key after this. */
const PREFIX = "arbor.draft.";

/**
 * What the person typed and has not sent, kept in `storage` so switching to
 * another conversation, another page or reloading never loses it. One per
 * key: a conversation's id, or what `newDraft`, `todoDraft` or `todoEdit`
 * names. Files attached to a draft are kept beside it for the page only,
 * since `storage` holds only text.
 */
// scry-ignore resources-are-disposable: it holds nothing but its listeners, which unlisten themselves
export class Drafts implements Eventful<DraftsEvents> {
	private readonly dispatcher = new Dispatcher<DraftsEvents>();
	readonly events = this.dispatcher.events;
	/** Every draft this page wrote, for when `storage` refuses to keep one. */
	private readonly kept = new Map<string, string>();
	private readonly attached = new Map<string, File[]>();

	/** Without `storage`, every draft lives as long as the page does. */
	constructor(private readonly storage: Storage | null = null) {}

	/** The draft under `key`, or empty when there is none. */
	read(key: string): string {
		try {
			return this.storage?.getItem(PREFIX + key) ?? this.kept.get(key) ?? "";
		} catch {
			return this.kept.get(key) ?? "";
		}
	}

	/** The files attached to the draft under `key`, if the page still has them. */
	files(key: string): File[] {
		return this.attached.get(key) ?? [];
	}

	/** Keeps `text` under `key`; an empty one drops the draft and its files. */
	write(key: string, text: string): void {
		this.store(key, text);
		this.dispatcher.dispatch("written", key);
	}

	/** Keeps `files` with the draft under `key`, for as long as the page. */
	attach(key: string, files: File[]): void {
		if (files.length === 0) {
			this.attached.delete(key);
		} else {
			this.attached.set(key, files);
		}
	}

	private store(key: string, text: string): void {
		if (text === "") {
			this.kept.delete(key);
			this.attached.delete(key);
		} else {
			this.kept.set(key, text);
		}
		try {
			if (text === "") {
				this.storage?.removeItem(PREFIX + key);
			} else {
				this.storage?.setItem(PREFIX + key, text);
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

/**
 * The key what is written to task `task`'s agent, which runs outside the
 * page, is kept under, each thing under a name of its own after it.
 */
export function externalDraft(project: string | null, task: string): string {
	return `external:${project ?? ""}:${task}`;
}

/** The key of the todo being added at the foot of `lane`, null the untriaged one. */
export function todoDraft(project: string | null, lane: number | null): string {
	return `todo:new:${project ?? ""}:${lane ?? "untriaged"}`;
}

/** The key of the unsaved edit to todo `id`. */
export function todoEdit(project: string | null, id: number): string {
	return `todo:${project ?? ""}:${id}`;
}

/**
 * A todo's words as a draft keeps them, with the names of the files attached
 * to it, so a reload can say which it dropped, and for an edit, the stored
 * files still kept.
 */
export interface TodoWords {
	subject: string;
	detail: string;
	keep?: string[];
}

/** A todo draft read back: its words, its files, and the names of any lost. */
export interface KeptTodo extends TodoWords {
	files: File[];
	/** Files attached before a reload, which `storage` could not keep. */
	dropped: string[];
}

/** The todo draft under `key`, or null when there is none. */
export function readTodo(drafts: Drafts, key: string): KeptTodo | null {
	const text = drafts.read(key);
	if (text === "") {
		return null;
	}
	let kept: TodoWords & { files?: string[] };
	try {
		kept = JSON.parse(text);
	} catch {
		return null;
	}
	const files = drafts.files(key);
	const names = new Set(files.map((file) => file.name));
	return {
		subject: kept.subject ?? "",
		detail: kept.detail ?? "",
		keep: kept.keep,
		files,
		dropped: (kept.files ?? []).filter((name) => !names.has(name)),
	};
}

/** Keeps a todo draft under `key`, or drops it for null. */
export function writeTodo(
	drafts: Drafts,
	key: string,
	words: TodoWords | null,
	files: File[] = [],
): void {
	if (words === null) {
		drafts.write(key, "");
		return;
	}
	drafts.write(
		key,
		JSON.stringify({ ...words, files: files.map((file) => file.name) }),
	);
	drafts.attach(key, files);
}
