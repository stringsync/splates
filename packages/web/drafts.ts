import { Dispatcher, type Eventful } from "webappwiz/events";

/** Says which draft was written, or thrown away, by its key. */
export type DraftsEvents = { written: string; discarded: string };

/** Where every draft is kept, each under its own key after this. */
const PREFIX = "splates.draft.";

/** Where the screen a new conversation's draft was written on is kept, by its key. */
const PLACED = "splates.draftAt.";

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
	/** Every place this page kept, for when `storage` refuses to keep one. */
	private readonly places = new Map<string, string>();

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

	/** Whether any draft holds text: something typed and not sent. */
	typed(): boolean {
		if (this.kept.size > 0) {
			return true;
		}
		try {
			for (let i = 0; i < (this.storage?.length ?? 0); i++) {
				const key = this.storage?.key(i) ?? "";
				if (key.startsWith(PREFIX) && this.storage?.getItem(key)) {
					return true;
				}
			}
		} catch {
			// Storage refused: the drafts kept in memory are all there are.
		}
		return false;
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

	/**
	 * Moves the draft under `from` to `to`, after any text already there, as
	 * when a new conversation's project changes, and its files after any there.
	 */
	move(from: string, to: string): void {
		const text = this.read(from);
		const files = this.files(from);
		if (from === to || (text === "" && files.length === 0)) {
			return;
		}
		const kept = this.read(to);
		const keptFiles = this.files(to);
		this.write(
			to,
			kept.trim() === "" ? text : text === "" ? kept : `${kept}\n\n${text}`,
		);
		this.attach(to, [...keptFiles, ...files]);
		this.write(from, "");
	}

	/** Keeps `files` with the draft under `key`, for as long as the page. */
	attach(key: string, files: File[]): void {
		const had = this.files(key);
		if (
			had.length === files.length &&
			had.every((each, i) => each === files[i])
		) {
			return;
		}
		if (files.length === 0) {
			this.attached.delete(key);
		} else {
			this.attached.set(key, files);
		}
		this.dispatcher.dispatch("written", key);
	}

	/** Throws away the draft under `key`, from any composer showing it too. */
	discard(key: string): void {
		this.write(key, "");
		this.dispatcher.dispatch("discarded", key);
	}

	/** Whether the draft under `key` holds anything: words or a file. */
	holds(key: string): boolean {
		return this.read(key) !== "" || this.files(key).length > 0;
	}

	/**
	 * The keys of the drafts held for conversations not started yet in
	 * `project`, as `newDraft` names them, the main tree's first.
	 */
	unstarted(project: string | null): string[] {
		const root = newDraft(project);
		const keys = new Set([...this.kept.keys(), ...this.attached.keys()]);
		try {
			for (let i = 0; i < (this.storage?.length ?? 0); i++) {
				const key = this.storage?.key(i) ?? "";
				if (key.startsWith(PREFIX)) {
					keys.add(key.slice(PREFIX.length));
				}
			}
		} catch {
			// Storage refused: the drafts kept in memory are all there are.
		}
		return [...keys]
			.filter(
				(key) =>
					(key === root || key.startsWith(`${root}:`)) && this.holds(key),
			)
			.sort((one, other) =>
				one === root ? -1 : other === root ? 1 : one.localeCompare(other),
			);
	}

	/**
	 * Keeps where the draft under `key` was written, the screen's place under
	 * `#conversations/`, as `new/codex`, so going back to it opens that again.
	 */
	place(key: string, open: string): void {
		this.places.set(key, open);
		try {
			this.storage?.setItem(PLACED + key, open);
		} catch {
			// Storage full or refused: the place lives as long as the page does.
		}
	}

	/** Where the draft under `key` was written, or null when it was not kept. */
	placeOf(key: string): string | null {
		try {
			return (
				this.storage?.getItem(PLACED + key) ?? this.places.get(key) ?? null
			);
		} catch {
			return this.places.get(key) ?? null;
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
// scry-ignore classes-over-function-exports: a pair of pure conversions between a draft's text and a todo, with no state for a class to hold
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
