import type { JSX, ReactNode } from "react";
import { useViewport } from "#dev/hooks/use-viewport.ts";
import { cn } from "#dev/lib/utils.ts";

/**
 * A phone's screen with a composer along its foot, pinned to what the
 * keyboard and Safari's bars leave of the page, so what is typed stays in
 * sight above the keyboard rather than under whatever Safari slides up.
 */
export function Screen({
	className,
	children,
}: {
	className?: string;
	children: ReactNode;
}): JSX.Element {
	const { top, height, keyboard } = useViewport();
	return (
		<div
			style={{ top, height }}
			className={cn(
				"fixed inset-x-0 flex flex-col overflow-hidden pt-[env(safe-area-inset-top)]",
				// The keyboard covers the home indicator, and the inset with it.
				!keyboard && "pb-[env(safe-area-inset-bottom)]",
				className,
			)}
		>
			{children}
		</div>
	);
}
