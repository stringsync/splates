import { type JSX, useContext } from "react";
import { Board, still, touchArea } from "./board";

/** Shows which lane a task is in, on a card away from its board; tap it to jump to that lane. */
export function LaneChip({
	lane,
	plain = false,
}: {
	lane: number | null | undefined;
	/** Renders as quiet truncated text instead of an outlined chip. */
	plain?: boolean;
}): JSX.Element | null {
	const { lanes, openLane } = useContext(Board);
	const found = lanes.find((each) => each.id === lane);
	if (found === undefined) {
		return null;
	}
	return (
		<button
			type="button"
			{...still}
			aria-label={`Open lane ${found.name}`}
			title={found.name}
			onClick={() => openLane(found.id)}
			className={
				plain
					? `relative w-fit max-w-full cursor-pointer truncate text-left text-muted-foreground text-xs outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring ${touchArea}`
					: `relative max-w-40 cursor-pointer truncate rounded-md border px-1.5 py-px text-foreground text-xs outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring ${touchArea}`
			}
		>
			{found.name}
		</button>
	);
}
