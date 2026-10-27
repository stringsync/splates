import { Disposer, type Resource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import { conversationIn, TASK } from "./conversation-address";
import { followShown } from "./navigation";
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
 * The page, conversation and task the address names, so a reload or a link
 * lands on the same page. Each move is an entry in the browser's history,
 * which back, forward and a phone's edge swipe move through.
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
	/** The todo `#todos/<N>` asks the board to open, or null. */
	todo = todoIn(location.hash);
	/** The cred the Creds page is set on, by name, or null. */
	cred = credIn(location.hash);
	/** The rule the Auto pick page is set on, by its place from 0, or null. */
	rule = ruleIn(location.hash);
	/** The batch and run the Evals page has open, each null for none. */
	evals = evalsIn(location.hash);
	/** The journey and step the Setup page is on, each null for none. */
	setup = setupIn(location.hash);
	/** Where Setup was left, which the Setup nav entry returns to. */
	private leftSetup: SetupOpen | null =
		this.setup.area === null ? null : this.setup;
	/** The window's scroll to put back once the entry returned to is drawn. */
	private scroll: number | null = null;

	/**
	 * Follows the address as the browser moves it, by its back and forward or
	 * a link, or as `NavigationContext`'s `show` does, until disposed.
	 */
	attach(): Resource {
		const disposer = new Disposer();
		// Put back by hand, since the page is drawn after the entry changes.
		history.scrollRestoration = "manual";
		for (const event of ["hashchange", "popstate"]) {
			window.addEventListener(event, this.follow);
			disposer.defer(() => window.removeEventListener(event, this.follow));
		}
		// An address in this project, as the merge popover opens, moves no
		// hash the browser tells of.
		disposer.defer(followShown(this.follow));
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
		this.todo = null;
		this.cred = null;
		this.rule = null;
		this.evals = NO_EVALS;
		this.setup = next === "setup" && this.leftSetup ? this.leftSetup : NO_SETUP;
		this.move(
			next === "setup"
				? setupAddress(this.setup)
				: next === "todos"
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
		// A dialog closing on its way elsewhere must not pull the page back.
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

	/** Opens batch `batch` on the Evals page, and its run `run` when given; none for null. */
	openEval(batch: string | null, run: string | null = null): void {
		this.page = "evals";
		this.evals = { batch, run: batch === null ? null : run };
		this.move(evalsAddress(this.evals));
	}

	/**
	 * Sets the Setup page on journey `area` and its step `step`, or on the
	 * index for a null `area`, which forgets where Setup was left.
	 */
	openSetup(
		area: string | null,
		step: string | null = null,
		how: Move = "push",
	): void {
		this.page = "setup";
		this.setup = area === null ? NO_SETUP : { area, step: step };
		this.leftSetup = area === null ? null : this.setup;
		this.move(setupAddress(this.setup), how);
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

	/** Keeps the journey Setup shows, for the nav entry to return to. */
	private remember(): void {
		if (this.page === "setup") {
			this.leftSetup = this.setup.area === null ? null : this.setup;
		}
	}

	private follow = () => {
		this.page = pageIn(location.hash);
		this.open = openIn(location.hash);
		this.task = taskIn(location.hash);
		this.lane = laneIn(location.hash);
		this.todo = todoIn(location.hash);
		this.cred = credIn(location.hash);
		this.rule = ruleIn(location.hash);
		this.evals = evalsIn(location.hash);
		this.setup = setupIn(location.hash);
		this.remember();
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

/** Whether the address names one of the main tree's terminals. */
function leavingTerminal(): boolean {
	const open = conversationIn(location.hash);
	return open !== null && isMain(open);
}

function entry(): Entry | null {
	return history.state as Entry | null;
}

function pageIn(hash: string): Page {
	// The Queue page, `#queue` and the Workers page it took in too.
	if (
		hash === "#tasks" ||
		hash === "#queue" ||
		hash === "#workers" ||
		taskIn(hash) !== null
	) {
		return "tasks";
	}

	if (laneIn(hash) !== null || todoIn(hash) !== null) {
		return "todos";
	}
	if (hash === "#stats") {
		return "stats";
	}
	if (hash === "#ships") {
		return "ships";
	}
	if (hash === "#evals" || hash.startsWith("#evals/")) {
		return "evals";
	}
	if (hash === "#creds" || hash.startsWith("#creds/")) {
		return "creds";
	}
	if (hash === "#billing" || hash === "#budget") {
		return "billing";
	}
	if (hash === "#automations") {
		return "automations";
	}
	if (hash === AUTO_PICK || hash === "#auto-pick" || ruleIn(hash) !== null) {
		return "auto-pick";
	}
	if (hash === "#setup" || hash.startsWith("#setup/")) {
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

/** The todo `#todos/<N>` opens on the board, or null. */
function todoIn(hash: string): number | null {
	const [, todo] = hash.match(/^#todos\/(\d+)$/) ?? [];
	return todo === undefined ? null : Number(todo);
}

/**
 * The address of the board with todo `id` open, as a link from another
 * project's page opens it.
 */
export function todoAddress(id: number): string {
	return `#todos/${id}`;
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

/** What the Setup page is on: a journey, and a step of it, each null for none. */
export interface SetupOpen {
	area: string | null;
	step: string | null;
}

const NO_SETUP: SetupOpen = { area: null, step: null };

/** The journey and step `#setup/<area>[/<step>]` sets the Setup page on. */
function setupIn(hash: string): SetupOpen {
	const [, area, step] = hash.match(/^#setup\/([^/]+)(?:\/([^/]+))?$/) ?? [];
	return area === undefined
		? NO_SETUP
		: {
				area: decodeURIComponent(area),
				step: step === undefined ? null : decodeURIComponent(step),
			};
}

/** The address of the Setup page set on `open`. */
export function setupAddress({ area, step }: SetupOpen): string {
	if (area === null) {
		return "#setup";
	}
	const base = `#setup/${encodeURIComponent(area)}`;
	return step === null ? base : `${base}/${encodeURIComponent(step)}`;
}

/** What the Evals page has open: a batch, and one of its runs. */
export interface EvalsOpen {
	batch: string | null;
	run: string | null;
}

const NO_EVALS: EvalsOpen = { batch: null, run: null };

/** The batch and run `#evals/<batch>[/<run>]` opens. */
function evalsIn(hash: string): EvalsOpen {
	const [, batch, run] = hash.match(/^#evals\/([^/]+)(?:\/(.+))?$/) ?? [];
	return batch === undefined
		? NO_EVALS
		: {
				batch: decodeURIComponent(batch),
				run: run === undefined ? null : decodeURIComponent(run),
			};
}

/** The address of the Evals page with `open` open. */
function evalsAddress({ batch, run }: EvalsOpen): string {
	return batch === null
		? "#evals"
		: `#evals/${encodeURIComponent(batch)}${run === null ? "" : `/${encodeURIComponent(run)}`}`;
}
