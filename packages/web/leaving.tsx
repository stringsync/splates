import { type JSX, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Button } from "#web/components/ui/button.tsx";
import { WAITS } from "./api";
import { TakingLong } from "./countdown";

/**
 * Covers the page while it goes to `name`'s, and makes the rest of it inert,
 * so nothing is clicked or typed into on the page being left. A server that
 * never answers leaves the person a way back to this page.
 */
export function Leaving({
	name,
	onStay,
}: {
	name: string;
	/** Uncovers this page again, as when the other never opens. */
	onStay: () => void;
}): JSX.Element {
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
			<div className="flex max-w-sm flex-col gap-2 rounded-xl border bg-popover px-4 py-3 text-sm shadow-lg">
				<span role="status">Opening {name}…</span>
				<TakingLong
					within={WAITS.answer}
					doing="opening"
					gaveUp={
						<>
							{name} has not opened: is it running?
							<Button variant="outline" size="sm" onClick={onStay}>
								Stay here
							</Button>
						</>
					}
				/>
			</div>
		</div>,
		document.body,
	);
}
