import { MaximizeIcon, MinimizeIcon } from "lucide-react";
import { type JSX, useSyncExternalStore } from "react";
import {
	DropdownMenuItem,
	DropdownMenuShortcut,
} from "#dev/components/ui/dropdown-menu.tsx";
import { useShortcut, useShortcutLabel } from "#dev/hooks/use-shortcut.ts";

/**
 * Its shortcut, ⌥⌘F unless set otherwise, toggles fullscreen from anywhere
 * on the page, where the browser allows it. Once per page, since two would
 * undo each other.
 */
export function useFullscreenKey(): void {
	useShortcut(
		"shortcuts.fullscreen",
		() => toggleFullscreen(),
		document.fullscreenEnabled,
	);
}

/**
 * The title menu's Fullscreen, into fullscreen or back out, as its shortcut does,
 * following Esc and the browser's own way out. Nothing where the browser
 * keeps fullscreen to itself, as Safari on an iPhone does.
 */
export function FullscreenItem(): JSX.Element | null {
	const on = useSyncExternalStore(
		(changed) => {
			document.addEventListener("fullscreenchange", changed);
			return () => document.removeEventListener("fullscreenchange", changed);
		},
		() => document.fullscreenElement != null,
	);
	const shortcut = useShortcutLabel("shortcuts.fullscreen");
	if (!document.fullscreenEnabled) {
		return null;
	}
	const Icon = on ? MinimizeIcon : MaximizeIcon;
	return (
		<DropdownMenuItem onClick={toggleFullscreen}>
			<Icon />
			{on ? "Exit fullscreen" : "Fullscreen"}
			{shortcut !== null && (
				<DropdownMenuShortcut aria-hidden>{shortcut}</DropdownMenuShortcut>
			)}
		</DropdownMenuItem>
	);
}

function toggleFullscreen(): void {
	// Refused only without a click or key behind it, which both ways in have.
	(document.fullscreenElement == null
		? document.documentElement.requestFullscreen()
		: document.exitFullscreen()
	).catch(() => {});
}
