import { MaximizeIcon, MinimizeIcon } from "lucide-react";
import { type JSX, useEffect, useSyncExternalStore } from "react";
import { Kbd } from "#dev/components/ui/kbd.tsx";

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
 * Into fullscreen, or back out, as ⌥⌘F does, following Esc and the browser's
 * own way out. Nothing where the browser keeps fullscreen to itself, as
 * Safari on an iPhone does.
 */
export function FullscreenButton({
	held,
}: {
	/** Whether ⌥⌘ is held, to show the key that toggles it with ⌥⌘. */
	held: boolean;
}): JSX.Element | null {
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
		<button
			type="button"
			data-row
			onClick={toggleFullscreen}
			className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-3 py-1.5 text-left text-muted-foreground text-xs hover:bg-muted"
		>
			<Icon className="size-3.5" />
			<span className="flex-1 truncate">
				{on ? "Exit fullscreen" : "Fullscreen"}
			</span>
			{held && (
				// Its own height, taller than the line, would push the rows below.
				<Kbd aria-hidden className="-my-0.5">
					F
				</Kbd>
			)}
		</button>
	);
}

function toggleFullscreen(): void {
	// Refused only without a click or key behind it, which both ways in have.
	(document.fullscreenElement == null
		? document.documentElement.requestFullscreen()
		: document.exitFullscreen()
	).catch(() => {});
}
