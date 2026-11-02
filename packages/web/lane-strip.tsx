import type { LaneState } from "@splates/server/board";
import { BACKLOG_LANE } from "@splates/server/board/browser";
import { LockIcon } from "lucide-react";
import { type JSX, type RefObject, useEffect, useState } from "react";
import { cn } from "#web/lib/utils.ts";

/**
 * On a phone, a chip per column above the board, each with its task count:
 * tapping one scrolls that column into view and the chip of the column in view
 * is highlighted. The strip itself scrolls sideways when the chips outgrow it.
 */
export function LaneStrip({
	lanes,
	untriaged,
	board,
}: {
	/** The lanes the board shows. */
	lanes: LaneState[];
	/** How many todos are in no lane, null when that column is hidden. */
	untriaged: number | null;
	/** The scroller holding the columns. */
	board: RefObject<HTMLElement | null>;
}): JSX.Element | null {
	const chips = [
		...(untriaged === null
			? []
			: [{ key: "none", name: "Untriaged", count: untriaged, locked: false }]),
		...lanes.map((lane) => ({
			key: String(lane.id),
			name: lane.name,
			count: lane.todos.length,
			locked: lane.id === BACKLOG_LANE,
		})),
	];
	const [current, setCurrent] = useState<string | null>(null);
	// The column nearest the board's left edge is the one in view.
	useEffect(() => {
		const scroller = board.current;
		if (scroller === null) {
			return;
		}
		const read = () => {
			const left = scroller.getBoundingClientRect().left;
			let nearest: { name: string; distance: number } | null = null;
			for (const column of scroller.querySelectorAll<HTMLElement>(
				"section[aria-label]",
			)) {
				const distance = Math.abs(column.getBoundingClientRect().left - left);
				if (nearest === null || distance < nearest.distance) {
					nearest = {
						name: column.getAttribute("aria-label") ?? "",
						distance,
					};
				}
			}
			setCurrent(nearest?.name ?? null);
		};
		read();
		scroller.addEventListener("scroll", read, { passive: true });
		return () => scroller.removeEventListener("scroll", read);
	}, [board]);
	if (chips.length === 0) {
		return null;
	}
	const jump = (name: string) => {
		const column = [
			...(board.current?.querySelectorAll<HTMLElement>("section[aria-label]") ??
				[]),
		].find((each) => each.getAttribute("aria-label") === name);
		column?.scrollIntoView({
			behavior: "smooth",
			block: "nearest",
			inline: "start",
		});
	};
	return (
		<nav
			aria-label="Lanes"
			className="-mx-4 mb-2 flex md:hidden shrink-0 gap-1.5 overflow-x-auto px-4 pb-1"
		>
			{chips.map((chip) => (
				<button
					key={chip.key}
					type="button"
					onClick={() => jump(chip.name)}
					aria-current={chip.name === current ? "true" : undefined}
					className={cn(
						"inline-flex h-7 pointer-coarse:h-10 shrink-0 items-center gap-1.5 rounded-full bg-muted px-3 text-xs outline-none hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring",
						chip.name === current && "bg-primary text-primary-foreground",
					)}
				>
					{chip.locked && <LockIcon aria-hidden className="size-3" />}
					<span className="max-w-40 truncate">{chip.name}</span>
					<span className="tabular-nums opacity-70">{chip.count}</span>
				</button>
			))}
		</nav>
	);
}
