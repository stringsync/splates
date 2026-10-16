import { useDisposerEffect, useReactive } from "@webappwiz/react";
import {
	ChartColumnIcon,
	GaugeIcon,
	KanbanIcon,
	KeyRoundIcon,
	LayersIcon,
	type LucideIcon,
	MessagesSquareIcon,
} from "lucide-react";
import { useLayoutEffect, useState } from "react";
import { useAttachKey } from "./components/assistant-ui/elements/attachment.aui";
import { useDictateKey } from "./dictate-button";
import { useFullscreenKey } from "./fullscreen";
import { useShortcut } from "./hooks/use-shortcut";
import { type Move, PageAddress } from "./page-address";
import type { ShortcutKey } from "./settings";
import { TaskIcon } from "./task-icon";

/**
 * The page's pages, the one in the address first: `#tasks` (or
 * `#tasks/<name>` for one open), `#conversations` (or `#conversations/<id>`
 * for one open), `#systems` (or `#systems/<name>` for one open), `#stats`,
 * `#creds`, `#budget`, `#setup`, or the board.
 */
export type Page =
	| "todos"
	| "tasks"
	| "conversations"
	| "systems"
	| "stats"
	| "creds"
	| "budget"
	| "setup";

/**
 * Each page in the nav, with the shortcut that opens it, if any. Setup is
 * not one: Settings and the nudge open it.
 */
export const PAGES: {
	value: Page;
	label: string;
	Icon: LucideIcon;
	shortcut?: ShortcutKey;
}[] = [
	{
		value: "conversations",
		label: "Conversations",
		Icon: MessagesSquareIcon,
	},
	{
		value: "todos",
		label: "Todos",
		Icon: KanbanIcon,
		shortcut: "shortcuts.todos",
	},
	{ value: "tasks", label: "Tasks", Icon: TaskIcon },
	{ value: "systems", label: "Systems", Icon: LayersIcon },
	{ value: "stats", label: "Stats", Icon: ChartColumnIcon },
	{ value: "creds", label: "Creds", Icon: KeyRoundIcon },
	{ value: "budget", label: "Budget", Icon: GaugeIcon },
];

/**
 * Where the page is, as `PageAddress` keeps it in the address and the
 * browser's history. `go`, `openTask` and `openSystem` are new each render.
 */
export function usePageRoute(): PageRoute {
	const [address] = useState(() => new PageAddress());
	useDisposerEffect((disposer) => disposer.use(address.attach()), [address]);
	const { page, open, task, system, cred } = useReactive(
		address,
		({ page, open, task, system, cred }) => ({
			page,
			open,
			task,
			system,
			cred,
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
		system,
		cred,
		go: (next, conversation, how) => address.go(next, conversation, how),
		openTask: (name) => address.openTask(name),
		openSystem: (name) => address.openSystem(name),
	};
}

/** How each page sits on a phone, under its bar; a conversation fills it. */
export const PHONE_PAGES: Record<Page, string> = {
	// As tall as the screen under its bar, so the board's scrollbar sits on
	// the screen's bottom edge.
	todos:
		"flex h-[calc(100dvh-var(--top-bar-height)-1px-env(safe-area-inset-top))] min-w-0 flex-col px-4 pt-4",
	tasks: "px-4 py-6",
	systems: "min-w-0 px-4 py-6",
	stats: "min-w-0 px-4 py-6",
	creds: "min-w-0 px-4 py-6",
	budget: "min-w-0 px-4 py-6",
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
	/** The system open on the Systems page, by name, or null. */
	system: string | null;
	/** Opens system `name` on the Systems page, or the list of them for null. */
	openSystem: (name: string | null) => void;
	/** The cred the Creds page is set on, by name, or null. */
	cred: string | null;
}
