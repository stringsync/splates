import { MaximizeIcon, MinimizeIcon } from "lucide-react";
import { type JSX, useEffect, useSyncExternalStore } from "react";
import {
	DropdownMenuItem,
	DropdownMenuShortcut,
} from "#dev/components/ui/dropdown-menu.tsx";

/**
 * ⌥⌘F (Ctrl+Alt+F off a Mac) toggles fullscreen from anywhere on the page,
 * where the browser allows it. Once per page, since two would undo each other.
 */
export function useFullscreenKey(): void {
	useEffect(() => {
		if (!document.fullscreenEnabled) {
			return;
		}
		// By the key's place, as ⌥⌘M, since Alt types another letter on a Mac.
		const listen = (event: KeyboardEvent) => {
			if (
				event.code === "KeyF" &&
				event.altKey &&
				(event.metaKey || event.ctrlKey)
			) {
				event.preventDefault();
				toggleFullscreen();
			}
		};
		document.addEventListener("keydown", listen);
		return () => document.removeEventListener("keydown", listen);
	}, []);
}

/**
 * The title menu's Fullscreen, into fullscreen or back out, as ⌥⌘F does,
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
	if (!document.fullscreenEnabled) {
		return null;
	}
	const Icon = on ? MinimizeIcon : MaximizeIcon;
	return (
		<DropdownMenuItem onClick={toggleFullscreen}>
			<Icon />
			{on ? "Exit fullscreen" : "Fullscreen"}
			<DropdownMenuShortcut aria-hidden>⌥⌘F</DropdownMenuShortcut>
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
