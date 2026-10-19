import { InboxIcon } from "lucide-react";
import { type JSX, useEffect, useState } from "react";
import { Duration, SystemTimer } from "webappwiz/time";
import { Kbd } from "#web/components/ui/kbd.tsx";
import { cn } from "#web/lib/utils.ts";

/** How long the line blinks once its shortcut finds nothing: three blinks of `animate-blink`. */
const NUDGE = Duration.ms(600);

/**
 * The sidebar's way to the inbox, counting the agents waiting on you, as the
 * phone drawer's Inbox does. Each time `nudges` goes up, as when the shortcut
 * to the next waiting finds nothing to open, it blinks a few times in place,
 * to catch the eye, starting over on a repeat.
 */
export function InboxLine({
	waiting,
	current,
	nudges,
	hint,
	onOpen,
}: {
	/** How many agents wait on you. */
	waiting: number;
	/** Whether the inbox is the page shown. */
	current: boolean;
	/** How many times its shortcut has found nothing, so far. */
	nudges: number;
	/** The key to show while ⌥⌘ is held, or null. */
	hint: string | null;
	onOpen: () => void;
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
			data-row
			data-lit={lit || undefined}
			aria-current={current ? "page" : undefined}
			onClick={onOpen}
			className={cn(
				"relative isolate flex h-9 min-w-0 flex-none items-center gap-3 rounded-md px-3 text-left text-sm hover:bg-muted [&_svg]:size-4",
				current && "bg-accent [&_svg]:text-primary",
			)}
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
			<InboxIcon />
			<span className="flex-1 truncate">Inbox</span>
			{hint !== null && (
				// Its own height, taller than the line, would push the rows below.
				<Kbd aria-hidden className="-my-0.5">
					{hint}
				</Kbd>
			)}
			<span
				role="status"
				aria-label={
					waiting > 0 ? `${waiting} waiting on you` : "Nothing waiting on you"
				}
				className={cn(
					"text-xs tabular-nums",
					waiting > 0 &&
						"rounded-full bg-warning px-2 py-0.5 font-medium text-background",
				)}
			>
				{waiting > 0 ? waiting : null}
			</span>
		</button>
	);
}
