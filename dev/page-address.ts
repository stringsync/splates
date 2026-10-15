import { Disposer, type Resource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import { conversationIn } from "./conversation-address";
import type { Page } from "./page-route";
import { isMain } from "./terminals";

export type PageAddressEvents = { changed: undefined };

/**
 * How a move leaves the browser's history: `push` adds an entry, `replace`
 * rewrites this one, for a move the page makes on its own, such as a phone
 * landing on its inbox or a draft becoming the conversation it started.
 */
export type Move = "push" | "replace";

/** What the page keeps in each entry of the browser's history. */
interface Entry {
	/** The address the page pushed this entry for. */
	at?: string;
	/** The address of the entry before this one, when the page pushed it. */
	back?: string;
	/** How far the window was scrolled when the page left this entry. */
	scroll?: number;
}

/**
 * The page, conversation, task and system the address names, kept in the
 * address so a reload or a link lands on the same page. Each move is an entry
 * in the browser's history, so its back and forward, and a phone's swipe from
 * the edge, move through them. A move to the entry just left goes back to it,
 * so a back button on the page and a swipe agree. A move away from a
 * terminal takes its entry, so going back never starts a shell.
 */
export class PageAddress implements Eventful<PageAddressEvents> {
	private readonly dispatcher = new Dispatcher<PageAddressEvents>();
	readonly events = this.dispatcher.events;

	page = pageIn(location.hash);
	/** The conversation open, by its address, or null. */
	open = conversationIn(location.hash);
	/** The task open on the Tasks page, or null. */
	task = taskIn(location.hash);
	/** The system open on the Systems page, by name, or null. */
	system = systemIn(location.hash);
	/** The window's scroll to put back once the entry returned to is drawn. */
	private scroll: number | null = null;

	/**
	 * Follows the address as the browser moves it, by its back and forward or
	 * a link, until disposed.
	 */
	attach(): Resource {
		const disposer = new Disposer();
		// Put back by hand, since the page is drawn after the entry changes.
		history.scrollRestoration = "manual";
		for (const event of ["hashchange", "popstate"]) {
			window.addEventListener(event, this.follow);
			disposer.defer(() => window.removeEventListener(event, this.follow));
		}
		return disposer;
	}

	/**
	 * Goes to `next`, with `conversation` open, the one open by default, in an
	 * entry of its own unless `how` is `replace`.
	 */
	go(next: Page, conversation = this.open, how: Move = "push"): void {
		this.page = next;
		this.open = conversation;
		this.task = null;
		this.system = null;
		this.move(
			next === "todos"
				? ""
				: next === "conversations" && conversation !== null
					? `#conversations/${conversation}`
					: `#${next}`,
			how,
		);
	}

	/** Opens task `name` on the Tasks page, or closes the one open for null. */
	openTask(name: string | null): void {
		this.task = name;
		// A dialog closing as it goes elsewhere, such as to its questions,
		// leaves the page and the address to where it went.
		if (name === null && taskIn(location.hash) === null) {
			this.dispatcher.dispatch("changed");
			return;
		}
		this.page = "tasks";
		this.move(name === null ? "#tasks" : `#tasks/${name}`);
	}

	/** Opens system `name` on the Systems page, or the list of them for null. */
	openSystem(name: string | null): void {
		this.page = "systems";
		this.system = name;
		this.move(
			name === null ? "#systems" : `#systems/${encodeURIComponent(name)}`,
		);
	}

	/**
	 * The window's scroll to put back, once, after the page draws the entry
	 * the browser went back or forward to, or null.
	 */
	takeScroll(): number | null {
		const scroll = this.scroll;
		this.scroll = null;
		return scroll;
	}

	private follow = () => {
		this.page = pageIn(location.hash);
		this.open = conversationIn(location.hash);
		this.task = taskIn(location.hash);
		this.system = systemIn(location.hash);
		this.scroll = entry()?.scroll ?? 0;
		this.dispatcher.dispatch("changed");
	};

	/** Moves the address to `hash`, or to none for the board's "". */
	private move(hash: string, how: Move = "push"): void {
		this.dispatcher.dispatch("changed");
		if (hash === location.hash) {
			return;
		}
		const url = hash === "" ? `${location.pathname}${location.search}` : hash;
		const here = entry();
		if (how === "replace") {
			history.replaceState(
				here?.at === undefined ? here : { ...here, at: hash },
				"",
				url,
			);
			return;
		}
		history.replaceState({ ...here, scroll: scrollY } satisfies Entry, "");
		// An entry the browser made, following a link, keeps no address of its
		// own, and may keep the state of the one before.
		if (here?.at === location.hash && here.back === hash) {
			history.back();
		} else if (leavingTerminal()) {
			const next: Entry = { at: hash, back: here?.back, scroll: 0 };
			history.replaceState(next, "", url);
		} else {
			const next: Entry = { at: hash, back: location.hash, scroll: 0 };
			history.pushState(next, "", url);
		}
	}
}

/** Whether the address names one of the main tree's terminals. */
function leavingTerminal(): boolean {
	const open = conversationIn(location.hash);
	return open !== null && isMain(open);
}

function entry(): Entry | null {
	return history.state as Entry | null;
}

function pageIn(hash: string): Page {
	if (hash === "#tasks" || hash.startsWith("#tasks/")) {
		return "tasks";
	}
	if (hash === "#systems" || hash.startsWith("#systems/")) {
		return "systems";
	}
	if (hash === "#stats") {
		return "stats";
	}
	if (hash === "#creds") {
		return "creds";
	}
	if (hash === "#budget") {
		return "budget";
	}
	return hash.startsWith("#conversations") ? "conversations" : "todos";
}

/** The task `#tasks/<name>` has open, or null. */
function taskIn(hash: string): string | null {
	const [, task] = hash.match(/^#tasks\/(.+)$/) ?? [];
	return task ?? null;
}

/** The system `#systems/<name>` has open, or null. */
function systemIn(hash: string): string | null {
	const [, system] = hash.match(/^#systems\/(.+)$/) ?? [];
	return system === undefined ? null : decodeURIComponent(system);
}
