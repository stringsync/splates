import { useDisposerEffect, useReactive } from "@webappwiz/react";
import {
	BookOpenIcon,
	ChartColumnIcon,
	FlaskConicalIcon,
	GaugeIcon,
	KanbanIcon,
	KeyRoundIcon,
	ListChecksIcon,
	type LucideIcon,
	ServerIcon,
	ZapIcon,
} from "lucide-react";
import { useCallback, useLayoutEffect, useState } from "react";
import { useAttachKey } from "./components/assistant-ui/elements/attachment.aui";
import { useDictateKey } from "./dictate-button";
import { useEscapeStopsDictation } from "./dictation-context";
import { useFullscreenKey } from "./fullscreen";
import { useShortcut } from "./hooks/use-shortcut";
import { type EvalsOpen, type Move, PageAddress } from "./page-address";
import type { ShortcutKey } from "./settings";
import { TaskIcon } from "./task-icon";

/**
 * The page's pages, the one in the address first: `#tasks` (or
 * `#tasks/<name>` for one open), `#conversations` (or `#conversations/<id>`
 * for one open), `#lanes/<id>` for the board opened on a lane, `#stats`, `#evals` (a checkout's only, or `#evals/<batch>[/<run>]` with one open),
 * `#creds`, `#budget`, `#workers`, `#automations`,
 * `#automations/auto-pick` (or `#automations/auto-pick/<n>` set on a rule),
 * `#setup`, or the board.
 */
export type Page =
	| "todos"
	| "tasks"
	| "conversations"
	| "stats"
	| "evals"
	| "creds"
	| "budget"
	| "workers"
	| "automations"
	| "auto-pick"
	| "setup"
	| "notes";

/**
 * Each page in the nav, with the shortcut that opens it, if any. Conversations
 * is not one: each layout lists its agents beside them.
 */
export const PAGES: {
	value: Page;
	label: string;
	Icon: LucideIcon;
	shortcut?: ShortcutKey;
}[] = [
	{
		value: "todos",
		label: "Board",
		Icon: KanbanIcon,
		shortcut: "shortcuts.todos",
	},
	{ value: "tasks", label: "Tasks", Icon: TaskIcon },
	{ value: "stats", label: "Stats", Icon: ChartColumnIcon },
	{ value: "evals", label: "Evals", Icon: FlaskConicalIcon },
	{ value: "creds", label: "Creds", Icon: KeyRoundIcon },
	{ value: "budget", label: "Budget", Icon: GaugeIcon },
	{ value: "workers", label: "Workers", Icon: ServerIcon },
	{ value: "automations", label: "Automations", Icon: ZapIcon },
	{ value: "notes", label: "Notes", Icon: BookOpenIcon },
	{ value: "setup", label: "Setup", Icon: ListChecksIcon },
];

/**
 * Where the page is, as `PageAddress` keeps it in the address and the
 * browser's history. Navigation actions retain their identity across renders.
 */
export function usePageRoute(): PageRoute {
	const [address] = useState(() => new PageAddress());
	useDisposerEffect((disposer) => disposer.use(address.attach()), [address]);
	const { page, open, task, lane, cred, rule, evals } = useReactive(
		address,
		({ page, open, task, lane, cred, rule, evals }) => ({
			page,
			open,
			task,
			lane,
			cred,
			rule,
			evals,
		}),
		["changed"],
	);
	useLayoutEffect(() => {
		const scroll = address.takeScroll();
		if (scroll !== null) {
			scrollTo(0, scroll);
		}
	});
	return {
		page,
		open,
		task,
		lane,
		cred,
		rule,
		evals,
		go: useCallback(
			(next, conversation, how) => address.go(next, conversation, how),
			[address],
		),
		openTask: useCallback((name) => address.openTask(name), [address]),
		openLane: useCallback((id) => address.openLane(id), [address]),
		openEval: useCallback(
			(batch, run) => address.openEval(batch, run),
			[address],
		),
	};
}

/**
 * The page in the nav that `page` sits under, so the nav marks it: Auto pick
 * opens from a card on Automations; every other page is its own.
 */
export function navPage(page: Page): Page {
	return page === "auto-pick" ? "automations" : page;
}

/** How each page sits on a phone, under its bar; a conversation fills it. */
export const PHONE_PAGES: Record<Page, string> = {
	// As tall as the screen under its bar, so the board's scrollbar sits on
	// the screen's bottom edge.
	todos:
		"flex h-[calc(100dvh-var(--top-bar-height)-1px-env(safe-area-inset-top))] min-w-0 flex-col px-4 pt-4",
	tasks: "px-4 py-6",
	stats: "min-w-0 px-4 py-6",
	evals: "min-w-0 px-4 py-6",
	creds: "min-w-0 px-4 py-6",
	budget: "min-w-0 px-4 py-6",
	workers: "min-w-0 px-4 py-6",
	automations: "min-w-0 px-4 py-6",
	"auto-pick": "min-w-0 px-4 py-6",
	notes: "min-w-0 px-4 py-6",
	setup: "min-w-0 px-4 py-6",
	conversations: "min-h-0 flex-1",
};

/**
 * The shortcuts that work from anywhere on the page, as the settings bind
 * them: each page's, back and forward through the conversations opened,
 * Settings, fullscreen, attaching files, and the open
 * conversation's terminal, from the terminal too, which leaves its key to
 * bubble up here.
 */
export function PageShortcuts({
	onPage,
	onBack,
	onForward,
	onSettings,
	onTerminal,
}: {
	onPage: (page: Page) => void;
	onBack: (() => void) | null;
	onForward: (() => void) | null;
	onSettings: () => void;
	onTerminal: (() => void) | null;
}): null {
	useShortcut("shortcuts.todos", () => onPage("todos"));
	useShortcut("shortcuts.back", () => onBack?.(), onBack !== null);
	useShortcut("shortcuts.forward", () => onForward?.(), onForward !== null);
	useShortcut("shortcuts.settings", onSettings);
	useShortcut("shortcuts.terminal", () => onTerminal?.(), onTerminal !== null);
	useFullscreenKey();
	useAttachKey();
	useDictateKey();
	useEscapeStopsDictation();
	return null;
}

/** Where the page is, as its address says, and the ways to move it. */
export interface PageRoute {
	page: Page;
	/** The conversation open, by its address, or null. */
	open: string | null;
	/** The task open on the Tasks page, or null. */
	task: string | null;
	/**
	 * Goes to `next`, with `conversation` open, the one open by default, in an
	 * entry of its own unless `how` is `replace`.
	 */
	go: (next: Page, conversation?: string | null, how?: Move) => void;
	/** Opens task `name` on the Tasks page, or closes the one open for null. */
	openTask: (name: string | null) => void;
	/** The lane the board was opened on, by id, or null. */
	lane: number | null;
	/** Opens the board on lane `id`, scrolled to its column. */
	openLane: (id: number) => void;
	/** The cred the Creds page is set on, by name, or null. */
	cred: string | null;
	/** The rule the Auto pick page is set on, by its place from 0, or null. */
	rule: number | null;
	/** The batch and run the Evals page has open. */
	evals: EvalsOpen;
	/** Opens batch `batch` on the Evals page, and its run `run` when given; none for null. */
	openEval: (batch: string | null, run?: string | null) => void;
}
