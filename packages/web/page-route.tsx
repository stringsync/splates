import { useDisposerEffect, useReactive } from "core/react";
import {
	ChartColumnIcon,
	GaugeIcon,
	HardHatIcon,
	KanbanIcon,
	KeyRoundIcon,
	ListChecksIcon,
	type LucideIcon,
	RadioIcon,
	ShieldCheckIcon,
	ShipIcon,
	SparklesIcon,
	VideoIcon,
} from "lucide-react";
import { useCallback, useLayoutEffect, useState } from "react";
import { useAttachKey } from "./components/assistant-ui/elements/attachment.aui";
import { useDictateKey } from "./dictate-button";
import { useEscapeStopsDictation } from "./dictation-context";
import { useFullscreenKey } from "./fullscreen";
import { useShortcut } from "./hooks/use-shortcut";
import { type Move, PageAddress, type SetupOpen } from "./page-address";
import type { ShortcutKey } from "./settings";

/** Where the page is, from its address, and the actions that move it. */
export function usePageRoute(): PageRoute {
	const [address] = useState(() => new PageAddress());
	useDisposerEffect((disposer) => disposer.use(address.attach()), [address]);
	const { page, open, task, lane, todo, cred, cell, shipRun, setup } =
		useReactive(
			address,
			({ page, open, task, lane, todo, cred, cell, shipRun, setup }) => ({
				shipRun,
				page,
				open,
				task,
				lane,
				todo,
				cred,
				cell,
				setup,
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
		todo,
		cred,
		cell,
		shipRun,
		setup,
		openSetup: useCallback(
			(area, step, how) => address.openSetup(area, step, how),
			[address],
		),
		go: useCallback(
			(next, conversation, how) => address.go(next, conversation, how),
			[address],
		),
		openTask: useCallback((name) => address.openTask(name), [address]),
		openLane: useCallback((id) => address.openLane(id), [address]),
	};
}

/**
 * The page's pages, the one in the address first: `#tasks` (or
 * `#tasks/<name>` for one open), `#conversations` (or `#conversations/<id>`
 * for one open), `#lanes/<id>` for the board opened on a lane, `#todos/<N>`
 * for it with todo N open, `#stats`, `#rigs` (or `#rigs/<run>` for a run), `#ships` (or `#ships/<run>` for a run),
 * `#creds`, `#signals`, `#trust`, `#billing` (`#budget` too), `#auto-pick`
 * (or `#auto-pick/<kind>.<depth>` set on a cell; `#automations` opens it too),
 * `#setup`, or the board.
 */
export type Page =
	| "todos"
	| "boards"
	| "tasks"
	| "conversations"
	| "stats"
	| "ships"
	| "rigs"
	| "rec"
	| "creds"
	| "signals"
	| "trust"
	| "billing"
	| "auto-pick"
	| "setup"
	| "welcome";

/**
 * Each page in the nav, with the shortcut that opens it, if any, and whether
 * it shows the project picked or every project, which the nav groups them
 * by: the project's first. Conversations is not one: each layout lists its
 * agents beside them, from every project.
 */
export const PAGES: {
	value: Page;
	label: string;
	Icon: LucideIcon;
	shortcut?: ShortcutKey;
	scope: "project" | "everywhere";
	primary?: boolean;
}[] = [
	{
		value: "boards",
		label: "Boards",
		Icon: KanbanIcon,
		shortcut: "shortcuts.todos",
		scope: "project",
		primary: true,
	},
	{ value: "creds", label: "Creds", Icon: KeyRoundIcon, scope: "project" },
	{
		value: "auto-pick",
		label: "Autopick",
		Icon: SparklesIcon,
		scope: "project",
	},
	{
		value: "stats",
		label: "Stats",
		Icon: ChartColumnIcon,
		scope: "everywhere",
	},
	{
		value: "ships",
		label: "Ships",
		Icon: ShipIcon,
		scope: "everywhere",
		primary: true,
	},
	{ value: "rigs", label: "Rigs", Icon: HardHatIcon, scope: "project" },
	{
		value: "signals",
		label: "Signals",
		Icon: RadioIcon,
		scope: "everywhere",
		primary: true,
	},
	{
		value: "trust",
		label: "Trust",
		Icon: ShieldCheckIcon,
		scope: "everywhere",
	},
	{
		value: "rec",
		label: "Rec",
		Icon: VideoIcon,
		scope: "everywhere",
		primary: true,
	},
	{ value: "billing", label: "Billing", Icon: GaugeIcon, scope: "everywhere" },
	{ value: "setup", label: "Setup", Icon: ListChecksIcon, scope: "everywhere" },
];

/** The page in the nav that `page` sits under, so the nav marks it: the board for a task's todo; every other page is its own. */
export function navPage(page: Page): Page {
	return page === "todos" ? "boards" : page;
}

/** The classes that lay each page out on a phone, under its bar. */
export const PHONE_PAGES: Record<Page, string> = {
	boards: "min-w-0 px-4 pt-4 pb-6",
	// As tall as the screen under its bar and compact area header, so the board's
	// scrollbar sits on the screen's bottom edge.
	todos:
		"flex h-[calc(100dvh-var(--top-bar-height)-var(--phone-header-height,2.75rem)-1px-env(safe-area-inset-top))] min-w-0 flex-col px-4 pt-3.5",
	tasks: "px-4 pt-4 pb-6",
	stats: "min-w-0 px-4 pt-4 pb-6",
	ships: "min-w-0 px-4 pt-4 pb-6",
	rigs: "min-w-0 px-4 pt-4 pb-6",
	rec: "min-w-0 px-4 pt-4 pb-6",
	creds: "min-w-0 px-4 pt-4 pb-6",
	signals: "min-w-0 px-4 pt-4 pb-6",
	trust: "min-w-0 px-4 pt-4 pb-6",
	billing: "min-w-0 px-4 pt-4 pb-6",
	"auto-pick": "min-w-0 px-4 pt-4 pb-6",
	setup: "min-w-0 px-4 pt-4 pb-6",
	welcome: "min-w-0 px-4 pt-4 pb-6",
	conversations: "flex min-h-0 flex-1 flex-col",
};

/**
 * The shortcuts that work from anywhere on the page, as the settings bind
 * them: opening each page, going back and forward, Settings, fullscreen,
 * attaching files and the open conversation's terminal. It also takes the
 * person to Ships when a ship's push is tapped.
 */
export function PageShortcuts({
	onPage,
	onBack,
	onForward,
	onSettings,
	onTerminal,
	// vet-ignore objects-over-callbacks: a React component's props, which are how React passes events
}: {
	onPage: (page: Page) => void;
	onBack: (() => void) | null;
	onForward: (() => void) | null;
	onSettings: () => void;
	onTerminal: (() => void) | null;
}): null {
	useShortcut("shortcuts.todos", () => onPage("boards"));
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
	/** The todo `#todos/<N>` asks the board to open, or null. */
	todo: number | null;
	/** Opens the board on lane `id`, scrolled to its column. */
	openLane: (id: number) => void;
	/** The cred the Creds page is set on, by name, or null. */
	cred: string | null;
	/** The cell the Autopick page is set on, `bugfix.deep`, or null. */
	cell: string | null;
	/** The ship run the Ships page shows, by id, or null. */
	shipRun: string | null;
	/** The journey and step the Setup page is on, each null for none. */
	setup: SetupOpen;
	/** Sets Setup on journey `area` and its `step`, or on the index for a null `area`. */
	openSetup: (area: string | null, step?: string | null, how?: Move) => void;
}
