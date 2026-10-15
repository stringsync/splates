import {
	ChartColumnIcon,
	GaugeIcon,
	GitBranchIcon,
	KanbanIcon,
	KeyRoundIcon,
	LayersIcon,
	type LucideIcon,
	MessagesSquareIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useAttachKey } from "./components/assistant-ui/elements/attachment.aui";
import { conversationIn } from "./conversation-address";
import { useFullscreenKey } from "./fullscreen";
import { useShortcut } from "./hooks/use-shortcut";
import type { ShortcutKey } from "./settings";

/**
 * The page's pages, the one in the address first: `#tasks` (or
 * `#tasks/<name>` for one open), `#conversations` (or `#conversations/<id>`
 * for one open), `#systems` (or `#systems/<name>` for one open), `#stats`,
 * `#creds`, `#budget`, or the board.
 */
export type Page =
	| "todos"
	| "tasks"
	| "conversations"
	| "systems"
	| "stats"
	| "creds"
	| "budget";

/** Each page with the shortcut that opens it, if any. */
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
	{ value: "tasks", label: "Tasks", Icon: GitBranchIcon },
	{ value: "systems", label: "Systems", Icon: LayersIcon },
	{ value: "stats", label: "Stats", Icon: ChartColumnIcon },
	{ value: "creds", label: "Creds", Icon: KeyRoundIcon },
	{ value: "budget", label: "Budget", Icon: GaugeIcon },
];

/**
 * The page, conversation and task the address names, kept in the address, so
 * a reload or a link lands on the same page. `go` and `openTask` are new each
 * render.
 */
export function usePageRoute(): PageRoute {
	const [page, setPage] = useState<Page>(() => pageIn(location.hash));
	const [open, setOpen] = useState(() => conversationIn(location.hash));
	const [task, setTask] = useState(() => taskIn(location.hash));
	const [system, setSystem] = useState(() => systemIn(location.hash));
	useEffect(() => {
		const follow = () => {
			setPage(pageIn(location.hash));
			setOpen(conversationIn(location.hash));
			setTask(taskIn(location.hash));
			setSystem(systemIn(location.hash));
		};
		window.addEventListener("hashchange", follow);
		return () => window.removeEventListener("hashchange", follow);
	}, []);
	const go = (next: Page, conversation: string | null = open) => {
		setPage(next);
		setOpen(conversation);
		setTask(null);
		setSystem(null);
		const hash =
			next === "conversations" && conversation !== null
				? `#conversations/${conversation}`
				: `#${next}`;
		history.replaceState(null, "", next === "todos" ? " " : hash);
	};
	const openTask = (name: string | null) => {
		setTask(name);
		// A dialog closing as it goes elsewhere, such as to its questions,
		// leaves the address to where it went.
		if (name !== null || taskIn(location.hash) !== null) {
			history.replaceState(
				null,
				"",
				name === null ? "#tasks" : `#tasks/${name}`,
			);
		}
	};
	const openSystem = (name: string | null) => {
		setPage("systems");
		setSystem(name);
		history.replaceState(
			null,
			"",
			name === null ? "#systems" : `#systems/${encodeURIComponent(name)}`,
		);
	};
	return { page, open, task, go, openTask, system, openSystem };
}

/** How each page sits on a phone, under its bar; a conversation fills it. */
export const PHONE_PAGES: Record<Page, string> = {
	todos: "min-w-0 px-4 py-4",
	tasks: "px-4 py-6",
	systems: "min-w-0 px-4 py-6",
	stats: "min-w-0 px-4 py-6",
	creds: "min-w-0 px-4 py-6",
	budget: "min-w-0 px-4 py-6",
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
	return null;
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

/** Where the page is, as its address says, and the ways to move it. */
export interface PageRoute {
	page: Page;
	/** The conversation open, by its address, or null. */
	open: string | null;
	/** The task open on the Tasks page, or null. */
	task: string | null;
	/** Goes to `next`, with `conversation` open, the one open by default. */
	go: (next: Page, conversation?: string | null) => void;
	/** Opens task `name` on the Tasks page, or closes the one open for null. */
	openTask: (name: string | null) => void;
	/** The system open on the Systems page, by name, or null. */
	system: string | null;
	/** Opens system `name` on the Systems page, or the list of them for null. */
	openSystem: (name: string | null) => void;
}
