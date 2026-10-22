import { type JSX, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

/**
 * Covers the page while it goes to `name`'s, and makes the rest of it inert,
 * so nothing is clicked or typed into on the page being left.
 */
export function Leaving({ name }: { name: string }): JSX.Element {
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const others = [...document.body.children].filter(
			(each): each is HTMLElement =>
				each instanceof HTMLElement && each !== ref.current && !each.inert,
		);
		for (const each of others) {
			each.inert = true;
		}
		return () => {
			for (const each of others) {
				each.inert = false;
			}
		};
	}, []);
	return createPortal(
		<div
			ref={ref}
			className="fixed inset-0 z-100 flex items-center justify-center bg-background/60 backdrop-blur-[2px] motion-safe:animate-in motion-safe:fade-in"
		>
			<div
				role="status"
				className="flex items-center gap-2 rounded-xl border bg-popover px-4 py-3 text-sm shadow-lg"
			>
				Opening {name}…
			</div>
		</div>,
		document.body,
	);
}
