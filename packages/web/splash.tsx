import { type JSX, useState } from "react";
import { cn } from "#web/lib/utils.ts";

/**
 * Covers the whole page with the 🍽️ on the theme's background while `shown`;
 * set it false once the page is ready, and it fades away. Set true again, as
 * when the page opens another project, it covers the page at once.
 */
export function Splash({ shown }: { shown: boolean }): JSX.Element | null {
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
