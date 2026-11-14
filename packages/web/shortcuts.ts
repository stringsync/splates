/**
 * A keyboard shortcut as a setting keeps it, like `Alt+Mod+KeyM`: modifiers
 * (`Ctrl`, `Alt`, `Shift`, `Mod`) and then the key's place (`KeyboardEvent.code`),
 * so it holds on any layout. `Mod` is ⌘ on a Mac and Ctrl elsewhere; `Ctrl`
 * with it means both. The empty string is no shortcut.
 */
export type Shortcut = string;

/** No shortcut: the one an unset shortcut holds. */
export const NONE: Shortcut = "";

/** In the order a shortcut keeps them, which is the order a Mac prints them. */
const MODIFIERS = ["Ctrl", "Alt", "Shift", "Mod"] as const;

type Modifier = (typeof MODIFIERS)[number];

/** What each modifier reads as, in a label, in the order a Mac prints them. */
const GLYPHS: Record<Modifier, string> = {
	Ctrl: "⌃",
	Alt: "⌥",
	Shift: "⇧",
	Mod: "⌘",
};

/** What a key whose place is not a letter or a digit reads as. */
const KEYS: Record<string, string> = {
	Backquote: "`",
	Minus: "-",
	Equal: "=",
	BracketLeft: "[",
	BracketRight: "]",
	Backslash: "\\",
	Semicolon: ";",
	Quote: "'",
	Comma: ",",
	Period: ".",
	Slash: "/",
	Backspace: "⌫",
	Delete: "⌦",
	Enter: "↵",
	Escape: "Esc",
	Tab: "⇥",
	Space: "Space",
	ArrowUp: "↑",
	ArrowDown: "↓",
	ArrowLeft: "←",
	ArrowRight: "→",
};

/** The places of the modifier keys themselves, which make no shortcut alone. */
const HELD = /^(Control|Alt|Shift|Meta|OS)(Left|Right)?$/;

interface Parsed {
	modifiers: ReadonlySet<Modifier>;
	code: string;
}

// vet-ignore export-leads-the-file: copied from the splates repository as it was; reworking it is its own task
function parse(shortcut: Shortcut): Parsed | null {
	const parts = shortcut.split("+");
	const code = parts.pop();
	if (code === undefined || code === "" || HELD.test(code)) {
		return null;
	}
	const modifiers = new Set(parts as Modifier[]);
	return parts.every((part) => MODIFIERS.includes(part as Modifier))
		? { modifiers, code }
		: null;
}

/**
 * Whether `shortcut` is one a setting can hold: none, or one or more of ⌃, ⌥
 * and ⌘ with a key, ⇧ optional, so a bare key never fires while typing.
 */
// vet-ignore export-leads-the-file: copied from the splates repository as it was; reworking it is its own task
export function valid(shortcut: Shortcut): boolean {
	if (shortcut === NONE) {
		return true;
	}
	const parsed = parse(shortcut);
	return (
		parsed !== null &&
		shortcut === format(parsed) &&
		(["Ctrl", "Alt", "Mod"] as const).some((each) => parsed.modifiers.has(each))
	);
}

function format({ modifiers, code }: Parsed): Shortcut {
	return [...MODIFIERS.filter((each) => modifiers.has(each)), code].join("+");
}

/** Whether `event` presses `shortcut`; never for none. */
export function matches(event: KeyboardEvent, shortcut: Shortcut): boolean {
	const parsed = parse(shortcut);
	if (parsed === null || event.code !== parsed.code) {
		return false;
	}
	const { modifiers } = parsed;
	const mod = modifiers.has("Mod");
	const ctrl = modifiers.has("Ctrl");
	return (
		event.altKey === modifiers.has("Alt") &&
		event.shiftKey === modifiers.has("Shift") &&
		(mod && ctrl
			? event.ctrlKey && event.metaKey
			: mod
				? event.ctrlKey || event.metaKey
				: ctrl
					? event.ctrlKey && !event.metaKey
					: !event.ctrlKey && !event.metaKey)
	);
}

/**
 * The shortcut `event` presses, to record it, or null while only modifiers
 * are down. ⌘ reads as `Mod`, and so does Ctrl off a Mac, which has no ⌘;
 * on a Mac, Ctrl is its own.
 */
export function recorded(event: KeyboardEvent, mac = onMac()): Shortcut | null {
	if (HELD.test(event.code) || event.code === "") {
		return null;
	}
	const modifiers = new Set<Modifier>();
	if (event.metaKey || (event.ctrlKey && !mac)) {
		modifiers.add("Mod");
	}
	if (event.ctrlKey && (mac || event.metaKey)) {
		modifiers.add("Ctrl");
	}
	if (event.altKey) {
		modifiers.add("Alt");
	}
	if (event.shiftKey) {
		modifiers.add("Shift");
	}
	return format({ modifiers, code: event.code });
}

/** What each modifier reads as off a Mac, which has no ⌘: Mod is Ctrl. */
const WORDS: Record<Modifier, string> = {
	Ctrl: "Ctrl",
	Alt: "Alt",
	Shift: "Shift",
	Mod: "Ctrl",
};

/**
 * How `shortcut` reads: `⌥⌘C` on a Mac, `Ctrl+Alt+C` off it, or "" for none.
 */
export function label(shortcut: Shortcut, mac = onMac()): string {
	const parsed = parse(shortcut);
	if (parsed === null) {
		return "";
	}
	const held = MODIFIERS.filter((each) => parsed.modifiers.has(each));
	if (mac) {
		return held.map((each) => GLYPHS[each]).join("") + keyOf(parsed.code);
	}
	return [
		...new Set(
			[
				...held.filter((each) => each === "Mod"),
				...held.filter((each) => each !== "Mod"),
			].map((each) => WORDS[each]),
		),
		keyOf(parsed.code),
	].join("+");
}

/**
 * The key of a ⌥⌘ shortcut alone, which the page shows beside what it opens
 * while ⌥⌘ is held; null for any other shortcut, or none.
 */
export function heldKey(shortcut: Shortcut): string | null {
	const parsed = parse(shortcut);
	return parsed !== null &&
		parsed.modifiers.size === 2 &&
		parsed.modifiers.has("Alt") &&
		parsed.modifiers.has("Mod")
		? keyOf(parsed.code)
		: null;
}

function keyOf(code: string): string {
	return (
		/^Key([A-Z])$/.exec(code)?.[1] ??
		/^Digit(\d)$/.exec(code)?.[1] ??
		KEYS[code] ??
		code
	);
}

/** The modifiers a shortcut may hold, as a sentence reads them. */
export function modifierNames(mac = onMac()): string {
	return mac ? "⌘, ⌃ or ⌥" : "Ctrl or Alt";
}

let macForTests: boolean | null = null;

/** Test-only: reads every shortcut as on a Mac, or off it, whatever the browser says. */
export function setMacForTests(mac: boolean | null): void {
	macForTests = mac;
}

/** Whether the page runs on a Mac, or reads as one under test. */
export function onMac(): boolean {
	return (
		macForTests ??
		/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
	);
}
