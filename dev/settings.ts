import { Dispatcher, type Eventful } from "webappwiz/events";
import { OPENERS, ZED } from "./openers";
import { NONE, type Shortcut, valid } from "./shortcuts";

export type SettingsEvents = { changed: undefined };

/** The groups the Settings dialog lists down its left, in order. */
export const CATEGORIES = [
	"Appearance",
	"Editor",
	"Notifications",
	"Restart",
	"Shortcuts",
] as const;

export type Category = (typeof CATEGORIES)[number];

/** Something the browser must allow before a setting can be on. */
interface Allowance {
	/** Whether this browser has it at all. */
	supported(): boolean;
	/** Whether it is allowed now. */
	allowed(): boolean;
	/** Asks for it, from a click, since browsers refuse otherwise. */
	ask(): Promise<boolean>;
	/** What to tell the person when it was refused. */
	refused: string;
}

/** One of the values a choice can take, with what the dialog calls it. */
export interface Choice {
	value: string;
	label: string;
}

/** A setting the person can change, as the dialog shows it. */
export interface Definition {
	category: Category;
	title: string;
	description: string;
	/** A switch for a boolean, a field for a number, a pick for a string. */
	default: boolean | number | string;
	/** What a string can be, in the order the dialog offers them. */
	choices?: readonly Choice[];
	/** Show each choice as a swatch of the accent it names. */
	swatches?: boolean;
	/** What a number counts, and the least it can be. */
	unit?: string;
	min?: number;
	/** A keyboard shortcut, its default the one the page starts with. */
	shortcut?: boolean;
	/** The switch this one does nothing without. */
	under?: string;
	browser?: Allowance;
}

const notifications: Allowance = {
	supported: () => typeof Notification !== "undefined",
	allowed: () =>
		typeof Notification !== "undefined" &&
		Notification.permission === "granted",
	ask: async () =>
		typeof Notification !== "undefined" &&
		(Notification.permission === "granted" ||
			(await Notification.requestPermission()) === "granted"),
	refused:
		"Notifications are blocked: allow them for this page in the browser's settings.",
};

/** The accents the page can wear, each a palette in styles.css. */
export const ACCENTS = [
	{ value: "graphite", label: "Graphite" },
	{ value: "teal", label: "Teal" },
	{ value: "indigo", label: "Indigo" },
	{ value: "violet", label: "Violet" },
	{ value: "blue", label: "Blue" },
	{ value: "green", label: "Green" },
	{ value: "amber", label: "Amber" },
	{ value: "rose", label: "Rose" },
] as const satisfies readonly Choice[];

/** Every setting, in the order the dialog shows them. */
export const SETTINGS = {
	"appearance.theme": {
		category: "Appearance",
		title: "Theme",
		description: "Light or dark, or whichever this device is set to.",
		default: "system",
		choices: [
			{ value: "system", label: "System" },
			{ value: "light", label: "Light" },
			{ value: "dark", label: "Dark" },
		],
	},
	"appearance.accent": {
		category: "Appearance",
		title: "Accent",
		description:
			"The color of buttons, switches, focus, and whatever is selected.",
		default: "graphite",
		choices: ACCENTS,
		swatches: true,
	},
	"conversation.widgets": {
		category: "Appearance",
		title: "Widgets beside conversations",
		description:
			"Show a conversation's actions, background commands and task beside its messages where there is room for them. Elsewhere they float over the conversation while you open them.",
		default: true,
	},
	"editor.opener": {
		category: "Editor",
		title: "Open files in",
		description:
			"Where a file an agent read or edited opens when you click it in a conversation.",
		default: ZED.id,
		choices: OPENERS.map(({ id, label }) => ({ value: id, label })),
	},
	"notifications.on": {
		category: "Notifications",
		title: "Notify me",
		description:
			"Show a browser notification when an agent needs you, finishes its turn, or goes quiet. Clicking one opens it.",
		default: false,
		browser: notifications,
	},
	"notifications.waiting": {
		category: "Notifications",
		title: "When an agent needs you",
		description:
			"It asks for permission or an answer, escalates, ends its turn on open questions, or fails.",
		default: true,
		under: "notifications.on",
	},
	"notifications.finished": {
		category: "Notifications",
		title: "When an agent finishes its turn",
		description: "With the start of what it said last.",
		default: true,
		under: "notifications.on",
	},
	"notifications.quiet": {
		category: "Notifications",
		title: "When an agent goes quiet",
		description: "It is still running, with no word for as long as below.",
		default: true,
		under: "notifications.on",
	},
	"notifications.quietAfter": {
		category: "Notifications",
		title: "Quiet after",
		description:
			"How long a running agent goes without a word before it counts as quiet. A long test run can be quiet for minutes.",
		default: 10,
		unit: "minutes",
		min: 1,
		under: "notifications.quiet",
	},
	"notifications.inFront": {
		category: "Notifications",
		title: "While the page is in front",
		description:
			"Notify even while you are looking at this page, where the sidebar's marks already say it.",
		default: false,
		under: "notifications.on",
	},
	"notifications.sound": {
		category: "Notifications",
		title: "Play a sound",
		description: "A short chime with each notification.",
		default: false,
		under: "notifications.on",
	},
	"restart.auto": {
		category: "Restart",
		title: "Restart when out of date",
		description:
			"Once a newer arbor is out, or commits land on the source arbor dev runs from, and every agent has been idle for a minute, restart arbor dev after a minute's countdown you can cancel.",
		default: "off",
		choices: [
			{ value: "off", label: "Off" },
			{ value: "restart", label: "Restart" },
			{ value: "reload", label: "Restart and reload" },
		],
	},
	"shortcuts.search": shortcut(
		"Search",
		"Find a task, conversation or todo.",
		"Mod+KeyK",
	),
	"shortcuts.settings": shortcut(
		"Settings",
		"Open these settings.",
		"Mod+Comma",
	),
	"shortcuts.projects": shortcut(
		"Switch project",
		"Open the list of projects on this machine.",
		"Ctrl+Mod+KeyP",
	),
	"shortcuts.todos": shortcut("Todos", "Open the todo board.", "Alt+Mod+KeyT"),
	"shortcuts.new": shortcut(
		"New conversation",
		"Start one with the agent, model and settings the last one started with.",
		"Alt+Mod+KeyN",
	),
	"shortcuts.back": shortcut(
		"Back",
		"Go back to the conversation opened before, as in a browser's history.",
		"Alt+Mod+Comma",
	),
	"shortcuts.forward": shortcut(
		"Forward",
		"Go forward again after going back.",
		"Alt+Mod+Period",
	),
	"shortcuts.waiting": shortcut(
		"Next waiting on you",
		"Open the next conversation waiting on you, or else the next unread one.",
		"Alt+Mod+KeyM",
	),
	"shortcuts.next": shortcut(
		"Next conversation",
		"Open the conversation below the one open, round past the end.",
		"Alt+Mod+BracketRight",
	),
	"shortcuts.previous": shortcut(
		"Previous conversation",
		"Open the conversation above the one open, round past the top.",
		"Alt+Mod+BracketLeft",
	),
	"shortcuts.archive": shortcut(
		"Archive conversation",
		"Archive the conversation open.",
		"Alt+Mod+Backspace",
	),
	"shortcuts.attach": shortcut(
		"Attach files",
		"Pick files to attach to the message being written.",
		"Alt+Mod+Semicolon",
	),
	"shortcuts.widgets": shortcut(
		"Widgets",
		"Show or hide the open conversation's widgets.",
		"Alt+Mod+Slash",
	),
	"shortcuts.terminal": shortcut(
		"Terminal",
		"Show or hide the open conversation's terminal.",
		"Ctrl+Backquote",
	),
	"shortcuts.checkpoint": shortcut(
		"Checkpoint",
		"Stop every agent where it stands, to pick up after a restart.",
		"Alt+Mod+KeyC",
	),
	"shortcuts.fullscreen": shortcut(
		"Fullscreen",
		"Go fullscreen, or back.",
		"Alt+Mod+KeyF",
	),
} satisfies Record<string, Definition>;

/** A setting for a shortcut, which the dialog records by pressing it. */
function shortcut(title: string, description: string, fallback: Shortcut) {
	return {
		category: "Shortcuts",
		title,
		description,
		default: fallback,
		shortcut: true,
	} as const satisfies Definition;
}

export type Key = keyof typeof SETTINGS;

/** The settings that hold a keyboard shortcut. */
export type ShortcutKey = {
	[K in Key]: (typeof SETTINGS)[K] extends { shortcut: true } ? K : never;
}[Key];

/** What a setting holds: a switch's boolean, a number, or a choice's value. */
export type Value<K extends Key> = K extends Key
	? (typeof SETTINGS)[K]["default"] extends boolean
		? boolean
		: (typeof SETTINGS)[K]["default"] extends number
			? number
			: string
	: never;

/** Where the settings are kept between visits, together. */
const STORED = "arbor.settings";

/**
 * The page's settings, kept in `storage` for the next visit: each one
 * changed reads as what it was set to, and every other as its default.
 */
// scry-ignore resources-are-disposable: it holds nothing but its listeners, which unlisten themselves
export class Settings implements Eventful<SettingsEvents> {
	private readonly dispatcher = new Dispatcher<SettingsEvents>();
	readonly events = this.dispatcher.events;

	private values: Partial<Record<Key, boolean | number | string>>;

	constructor(private readonly storage: Storage) {
		this.values = storedIn(storage);
	}

	/**
	 * What `key` is set to. One the browser must allow reads as off while it
	 * does not, as when it was taken back in the browser's own settings.
	 */
	get<K extends Key>(key: K): Value<K> {
		const definition: Definition = SETTINGS[key];
		const value = this.values[key] ?? definition.default;
		return (
			definition.browser && !definition.browser.allowed() ? false : value
		) as Value<K>;
	}

	/**
	 * Sets `key` to `value`, asking the browser first when it must allow it.
	 * False when it refused, leaving the setting as it was.
	 */
	async set<K extends Key>(key: K, value: Value<K>): Promise<boolean> {
		const definition: Definition = SETTINGS[key];
		if (
			value === true &&
			definition.browser &&
			!(await definition.browser.ask())
		) {
			return false;
		}
		this.values = { ...this.values, [key]: value };
		this.storage.setItem(STORED, JSON.stringify(this.values));
		this.dispatcher.dispatch("changed");
		return true;
	}

	/**
	 * Sets shortcut `key` to `shortcut`, taking it from whichever other
	 * shortcut had it, which this returns, left with none.
	 */
	async bind(
		key: ShortcutKey,
		shortcut: Shortcut,
	): Promise<ShortcutKey | null> {
		const had =
			shortcut === NONE
				? undefined
				: shortcutKeys().find(
						(other) => other !== key && this.get(other) === shortcut,
					);
		if (had !== undefined) {
			await this.set(had, NONE);
		}
		await this.set(key, shortcut);
		return had ?? null;
	}
}

/** Every setting that holds a shortcut, in the order the dialog shows them. */
export function shortcutKeys(): ShortcutKey[] {
	return (Object.keys(SETTINGS) as Key[]).filter(
		(key): key is ShortcutKey =>
			(SETTINGS[key] as Definition).shortcut === true,
	);
}

/**
 * The settings matching `query`, by their title, description or category,
 * every word of it somewhere; all of them for an empty one.
 */
export function search(query: string): Key[] {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	return (Object.keys(SETTINGS) as Key[]).filter((key) => {
		const { category, title, description } = SETTINGS[key] as Definition;
		const text = `${category} ${title} ${description}`.toLowerCase();
		return words.every((word) => text.includes(word));
	});
}

/** The definition of `key`, as the dialog reads it. */
export function definitionOf(key: Key): Definition {
	return SETTINGS[key];
}

function storedIn(
	storage: Storage,
): Partial<Record<Key, boolean | number | string>> {
	try {
		const stored: unknown = JSON.parse(storage.getItem(STORED) ?? "{}");
		if (typeof stored !== "object" || stored === null) {
			return {};
		}
		// Only what the page still knows of, of the right kind, for a choice,
		// one it still offers, and for a shortcut, one it can press.
		return Object.fromEntries(
			Object.entries(stored).filter(([key, value]) => {
				if (!(key in SETTINGS)) {
					return false;
				}
				const {
					default: fallback,
					choices,
					shortcut,
				}: Definition = SETTINGS[key as Key];
				return (
					typeof value === typeof fallback &&
					(!shortcut || valid(value as Shortcut)) &&
					(choices === undefined ||
						choices.some((choice) => choice.value === value))
				);
			}),
		);
	} catch {
		return {};
	}
}
