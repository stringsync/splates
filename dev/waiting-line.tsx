import { CircleAlertIcon, CircleCheckIcon } from "lucide-react";
import { type JSX, useEffect, useState } from "react";
import { Duration, SystemTimer } from "webappwiz/time";
import { Kbd } from "#dev/components/ui/kbd.tsx";
import { cn } from "#dev/lib/utils.ts";

/** How long the line stays lit once ⌥⌘M finds nothing, before it fades. */
const NUDGE = Duration.secs(1.5);

/**
 * A line of one height that always says how many agents wait on you, so
 * nothing moves as the count changes. Clicking it opens the next one, as
 * ⌥⌘M does. Each time `nudges` goes up, as when ⌥⌘M finds nothing to open,
 * it lights up in place, as Checkpoint does under the pointer, and fades
 * back.
 */
export function WaitingLine({
	waiting,
	nudges,
	held,
	onNext,
}: {
	/** How many agents wait on you. */
	waiting: number;
	/** How many times ⌥⌘M has found nothing, so far. */
	nudges: number;
	/** Whether ⌥⌘ is held, to show the key that goes with it. */
	held: boolean;
	onNext: () => void;
}): JSX.Element {
	const [lit, setLit] = useState(false);
	useEffect(() => {
		if (nudges === 0) {
			return;
		}
		setLit(true);
		const fade = new SystemTimer().setTimeout(() => setLit(false), NUDGE);
		return () => fade.dispose();
	}, [nudges]);

	return (
		<button
			type="button"
			data-lit={lit || undefined}
			onClick={onNext}
			className={cn(
				"flex min-w-0 items-center gap-2 rounded-md px-3 py-1.5 text-left text-muted-foreground text-xs transition-colors duration-700 hover:bg-muted",
				lit && "bg-muted duration-0",
			)}
		>
			{waiting > 0 ? (
				<CircleAlertIcon className="size-3.5 text-warning" />
			) : (
				<CircleCheckIcon className="size-3.5" />
			)}
			<span role="status" className="flex-1 truncate">
				{waiting > 0 ? `${waiting} waiting on you` : "Nothing waiting on you"}
			</span>
			{held && (
				// Its own height, taller than the line, would push the rows below.
				<Kbd aria-hidden className="-my-0.5">
					M
				</Kbd>
			)}
		</button>
	);
}
