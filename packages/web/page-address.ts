import { Disposer, type Resource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import { conversationIn, TASK } from "./conversation-address";
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
	/** Set on the entry pushed above the inbox by `holdHome`. */
	held?: boolean;
}

/**
 * The page, conversation and task the address names, kept in the
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
	open = openIn(location.hash);
	/** The task open on the Tasks page, or null. */
	task = taskIn(location.hash);
	/** The lane the board was opened on, by id, or null. */
	lane = laneIn(location.hash);
	/** The cred the Creds page is set on, by name, or null. */
	cred = credIn(location.hash);
	/** The rule the Auto pick page is set on, by its place from 0, or null. */
	rule = ruleIn(location.hash);
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
		// A task whose agent runs outside the page opens as the task it is.
		if (next === "conversations" && conversation?.startsWith(TASK)) {
			this.openTask(conversation.slice(TASK.length));
			return;
		}
		this.page = next;
		this.open = conversation;
		this.task = null;
		this.lane = null;
		this.cred = null;
		this.rule = null;
		this.move(
			next === "todos"
				? ""
				: next === "conversations" && conversation !== null
					? `#conversations/${conversation}`
					: next === "auto-pick"
						? AUTO_PICK
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

	/** Opens the board on lane `id`, scrolled to its column. */
	openLane(id: number): void {
		this.page = "todos";
		this.open = null;
		this.task = null;
		this.cred = null;
		this.lane = id;
		this.move(laneAddress(id));
	}

	/** Sets the Creds page on cred `name`, or on none for null. */
	openCred(name: string | null): void {
		this.page = "creds";
		this.cred = name;
		this.move(name === null ? "#creds" : credAddress(name));
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
		this.open = openIn(location.hash);
		this.task = taskIn(location.hash);
		this.lane = laneIn(location.hash);
		this.cred = credIn(location.hash);
		this.rule = ruleIn(location.hash);
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

/**
 * Goes back to `hash` when the page pushed this entry from it, as a back
 * button does, saying whether it did; never out of the page.
 */
export function backTo(hash: string): boolean {
	const here = entry();
	if (here?.at !== location.hash || here.back !== hash) {
		return false;
	}
	history.back();
	return true;
}

/**
 * Holds the inbox as the bottom of history: an entry is pushed above it, so a
 * back from the inbox, as a phone's swipe from the edge, lands on the entry
 * below, which `onBack` is told of as the entry above is put back. Returns
 * the stop.
 */
export function holdHome(onBack: () => void): () => void {
	const hold = () => {
		const here = entry();
		if (here?.held !== true) {
			history.pushState({ ...here, held: true } satisfies Entry, "");
		}
	};
	const back = () => {
		if (entry()?.held !== true) {
			hold();
			onBack();
		}
	};
	hold();
	window.addEventListener("popstate", back);
	return () => window.removeEventListener("popstate", back);
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
	if (hash === "#tasks" || taskIn(hash) !== null) {
		return "tasks";
	}

	if (laneIn(hash) !== null) {
		return "todos";
	}
	if (hash === "#stats") {
		return "stats";
	}
	if (hash === "#creds" || hash.startsWith("#creds/")) {
		return "creds";
	}
	if (hash === "#budget") {
		return "budget";
	}
	if (hash === "#workers") {
		return "workers";
	}
	if (hash === "#automations") {
		return "automations";
	}
	if (hash === AUTO_PICK || hash === "#auto-pick" || ruleIn(hash) !== null) {
		return "auto-pick";
	}
	if (hash === "#notes") {
		return "notes";
	}
	if (hash === "#setup") {
		return "setup";
	}
	return hash.startsWith("#conversations") ? "conversations" : "todos";
}

/**
 * The task `#tasks/<name>` has open, or null. So does
 * `#conversations/task/<name>`, where a link or a notification from before
 * external agents' tasks moved to the Tasks page opens one.
 */
function taskIn(hash: string): string | null {
	const [, task] =
		hash.match(/^#tasks\/(.+)$/) ??
		hash.match(new RegExp(`^#conversations/${TASK}(.+)$`)) ??
		[];
	return task ?? null;
}

/** The conversation the address has open, but for a task's `taskIn` reads. */
function openIn(hash: string): string | null {
	const open = conversationIn(hash);
	return open?.startsWith(TASK) ? null : open;
}

/** The lane `#lanes/<id>` opens the board on, or null. */
function laneIn(hash: string): number | null {
	const [, lane] = hash.match(/^#lanes\/(\d+)$/) ?? [];
	return lane === undefined ? null : Number(lane);
}

/** The address of the board opened on lane `id`. */
export function laneAddress(id: number): string {
	return `#lanes/${id}`;
}

/** The cred `#creds/<name>` sets the Creds page on, or null. */
function credIn(hash: string): string | null {
	const [, cred] = hash.match(/^#creds\/(.+)$/) ?? [];
	return cred === undefined ? null : decodeURIComponent(cred);
}

/** The address of the Creds page set on cred `name`. */
export function credAddress(name: string): string {
	return `#creds/${encodeURIComponent(name)}`;
}

/** The Auto pick page's address, under Automations, where its card opens it. */
const AUTO_PICK = "#automations/auto-pick";

/**
 * The rule `#automations/auto-pick/<n>` sets the Auto pick page on, from 0,
 * or null. So does `#auto-pick/<n>`, where a link from when Auto pick was a
 * page of the nav opens one.
 */
function ruleIn(hash: string): number | null {
	const [, rule] = hash.match(/^#(?:automations\/)?auto-pick\/(\d+)$/) ?? [];
	return rule === undefined ? null : Number(rule) - 1;
}

/** The address of the Auto pick page set on rule `index`, from 0. */
export function ruleAddress(index: number): string {
	return `${AUTO_PICK}/${index + 1}`;
}
