import { CircleAlertIcon, CircleCheckIcon } from "lucide-react";
import { type JSX, useEffect, useState } from "react";
import { Duration, SystemTimer } from "webappwiz/time";
import { Kbd } from "#dev/components/ui/kbd.tsx";

/** How long the line blinks once its shortcut finds nothing: three blinks of `animate-blink`. */
const NUDGE = Duration.ms(600);

/**
 * A line of one height that always says how many agents wait on you, so
 * nothing moves as the count changes. Clicking it opens the next one, as
 * its shortcut does. Each time `nudges` goes up, as when that finds nothing to open,
 * it blinks a few times in place, to catch the eye, starting over on a repeat.
 */
export function WaitingLine({
	waiting,
	nudges,
	hint,
	onNext,
}: {
	/** How many agents wait on you. */
	waiting: number;
	/** How many times its shortcut has found nothing, so far. */
	nudges: number;
	/** The key to show while ⌥⌘ is held, or null. */
	hint: string | null;
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
			className="relative isolate flex min-w-0 items-center gap-2 rounded-md px-3 py-1.5 text-left text-muted-foreground text-xs hover:bg-muted"
		>
			{lit && (
				// Keyed by the nudge, so a repeat starts the blinks over without
				// remounting the button, which may hold focus.
				<span
					key={nudges}
					aria-hidden
					className="-z-10 pointer-events-none absolute inset-0 animate-blink rounded-md bg-foreground/15 motion-reduce:animate-none"
				/>
			)}
			{waiting > 0 ? (
				<CircleAlertIcon className="size-3.5 text-warning" />
			) : (
				<CircleCheckIcon className="size-3.5" />
			)}
			<span role="status" className="flex-1 truncate">
				{waiting > 0 ? `${waiting} waiting on you` : "Nothing waiting on you"}
			</span>
			{hint !== null && (
				// Its own height, taller than the line, would push the rows below.
				<Kbd aria-hidden className="-my-0.5">
					{hint}
				</Kbd>
			)}
		</button>
	);
}
