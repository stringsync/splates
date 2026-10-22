import { type JSX, useEffect, useState } from "react";
import { cn } from "#web/lib/utils.ts";

// How long `wanted` must stay false before the splash starts to fade, so the
// page's loading flags flipping back and forth while it settles never reverse
// a fade half done, which showed as a flicker.
const SETTLE_MS = 80;

/**
 * Covers the whole page with the 🍽️ on the theme's background while `wanted`;
 * set it false once the page is ready, and it fades away. Set true again, as
 * when the page opens another project, it covers the page at once.
 */
export function Splash({ wanted }: { wanted: boolean }): JSX.Element | null {
	const shown = useSettled(wanted);
	// Drawn as index.html draws it before the app mounts, so the swap never
	// shows; gone once the fade ends, so nothing is left over the page.
	const [gone, setGone] = useState(!shown);
	if (shown && gone) {
		setGone(false);
	}
	if (gone) {
		return null;
	}
	return (
		<div
			aria-hidden="true"
			className={cn(
				"fixed inset-0 z-[100] grid place-items-center bg-background text-[96px] leading-none transition-opacity duration-150 ease-out will-change-[opacity]",
				!shown && "pointer-events-none opacity-0",
			)}
			onTransitionEnd={() => {
				if (!shown) {
					setGone(true);
				}
			}}
		>
			🍽️
		</div>
	);
}

/** `wanted`, except that going false waits SETTLE_MS; going true is at once. */
function useSettled(wanted: boolean): boolean {
	const [settled, setSettled] = useState(wanted);
	if (wanted && !settled) {
		setSettled(true);
	}
	useEffect(() => {
		if (wanted) {
			return;
		}
		const timer = setTimeout(() => setSettled(false), SETTLE_MS);
		return () => clearTimeout(timer);
	}, [wanted]);
	return settled;
}
