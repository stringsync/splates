import {
	createContext,
	useContext,
	useEffect,
	useRef,
	useSyncExternalStore,
} from "react";
import { useTouch } from "#dev/hooks/use-touch.ts";
import {
	definitionOf,
	type Settings,
	type ShortcutKey,
} from "#dev/settings.ts";
import {
	heldKey,
	label,
	matches,
	NONE,
	type Shortcut,
} from "#dev/shortcuts.ts";

/** The page's settings, for the shortcuts; each one's default without them. */
export const ShortcutSettings = createContext<Settings | null>(null);

/**
 * What shortcut `name` is set to, following the settings as they change;
 * none for no name.
 */
export function useBinding(name: ShortcutKey | undefined): Shortcut {
	const settings = useContext(ShortcutSettings);
	return useSyncExternalStore(
		(changed) => settings?.events.on("changed", changed) ?? (() => {}),
		() =>
			name === undefined
				? NONE
				: settings === null
					? (definitionOf(name).default as Shortcut)
					: settings.get(name),
	);
}

/**
 * Runs `run` on shortcut `name`, from anywhere on the page, while `enabled`.
 * One that returns false had nothing to do, and leaves the key to the page.
 */
export function useShortcut(
	name: ShortcutKey,
	// scry-ignore objects-over-callbacks: a handler for one key, kept in a ref so a fresh arrow does not re-listen
	run: (event: KeyboardEvent) => unknown,
	enabled = true,
): void {
	const shortcut = useBinding(name);
	const runRef = useRef(run);
	runRef.current = run;
	useEffect(() => {
		if (!enabled) {
			return;
		}
		const listen = (event: KeyboardEvent) => {
			if (matches(event, shortcut) && runRef.current(event) !== false) {
				event.preventDefault();
			}
		};
		window.addEventListener("keydown", listen);
		return () => window.removeEventListener("keydown", listen);
	}, [shortcut, enabled]);
}

/**
 * How shortcut `name` reads, as `⌥⌘C`, or null while it has none, or on a
 * touch device, which shows no shortcuts.
 */
export function useShortcutLabel(name: ShortcutKey): string | null {
	const shown = label(useBinding(name)) || null;
	return useTouch() ? null : shown;
}

/**
 * The key shortcut `name` shows beside what it opens while ⌥⌘ is held, or
 * null when it is not ⌥⌘ and a key.
 */
export function useHeldKey(name: ShortcutKey | undefined): string | null {
	return heldKey(useBinding(name));
}
