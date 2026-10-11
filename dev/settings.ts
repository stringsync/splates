import { Dispatcher, type Eventful } from "webappwiz/events";

export type SettingsEvents = { changed: undefined };

/** The groups the Settings dialog lists down its left, in order. */
export const CATEGORIES = ["Notifications"] as const;

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

/** A setting the person can change, as the dialog shows it. */
export interface Definition {
	category: Category;
	title: string;
	description: string;
	/** A switch for a boolean, a field for a number. */
	default: boolean | number;
	/** What a number counts, and the least it can be. */
	unit?: string;
	min?: number;
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

/** Every setting, in the order the dialog shows them. */
export const SETTINGS = {
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
} satisfies Record<string, Definition>;

export type Key = keyof typeof SETTINGS;

/** What a setting holds: a switch's boolean, or a number. */
export type Value<K extends Key> = K extends Key
	? (typeof SETTINGS)[K]["default"] extends boolean
		? boolean
		: number
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

	private values: Partial<Record<Key, boolean | number>>;

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

function storedIn(storage: Storage): Partial<Record<Key, boolean | number>> {
	try {
		const stored: unknown = JSON.parse(storage.getItem(STORED) ?? "{}");
		if (typeof stored !== "object" || stored === null) {
			return {};
		}
		// Only what the page still knows of, and of the right kind.
		return Object.fromEntries(
			Object.entries(stored).filter(
				([key, value]) =>
					key in SETTINGS &&
					typeof value === typeof SETTINGS[key as Key].default,
			),
		);
	} catch {
		return {};
	}
}
