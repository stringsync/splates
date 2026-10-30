import { CircleAlertIcon } from "lucide-react";
import {
	createContext,
	type JSX,
	useContext,
	useEffect,
	useState,
} from "react";
import { Duration, SystemTimer, SystemWallClock } from "webappwiz/time";
import { HeldFeed } from "./handed-out";
import { useShowPending } from "./pending";
import {
	SEND_TIMEOUT,
	type Sending,
	STILL_SENDING,
	type Unsent,
} from "./sending";

/** A thread's messages the server refused, and what can be done with each. */
export interface UnsentActions {
	unsent: readonly Unsent[];
	retry: (message: Sending) => void;
	edit: (message: Sending) => void;
}

export const UnsentContext = createContext<UnsentActions>({
	unsent: [],
	retry: () => {},
	edit: () => {},
});

/**
 * Under a message the server has yet to answer, sent at `since` (epoch ms):
 * says it is sending, and once a few seconds have passed, how long till it
 * times out.
 */
export function SendingLine({ since }: { since: number | null }): JSX.Element {
	// The countdown runs on this line's own timer, so the feed is not redrawn.
	const shown = useShowPending(true);
	const feed = useContext(HeldFeed);
	const timer = feed?.timer;
	const wall = feed?.wall;
	const [now, setNow] = useState(() => (wall ?? new SystemWallClock()).now());
	useEffect(() => {
		if (since === null) {
			return;
		}
		const clock = wall ?? new SystemWallClock();
		const timers = timer ?? new SystemTimer();
		let pending: { dispose(): void } | null = null;
		const arm = () => {
			const elapsed = clock.now() - since;
			const wait =
				elapsed < STILL_SENDING.ms
					? STILL_SENDING.ms - elapsed
					: Duration.secs(1).ms - (elapsed % Duration.secs(1).ms);
			pending = timers.setTimeout(() => {
				setNow(clock.now());
				arm();
			}, Duration.ms(wait));
		};
		arm();
		return () => pending?.dispose();
	}, [since, timer, wall]);
	const elapsed = since === null ? 0 : now - since;
	const seconds =
		elapsed >= STILL_SENDING.ms
			? Math.max(
					0,
					Math.ceil((SEND_TIMEOUT.ms - elapsed) / Duration.secs(1).ms),
				)
			: null;
	const visible = shown || seconds !== null;
	// Reserve the line before its words appear so they move nothing and stay
	// above the sticky message’s fade, which starts below its content.
	return (
		<div
			data-slot="aui_user-message-sending"
			className="text-muted-foreground relative h-4 w-full text-xs"
		>
			{visible && (
				<span className="absolute start-1 top-0 flex items-center gap-1 whitespace-nowrap">
					{seconds === null ? "Sending…" : `Sending… times out in ${seconds}s`}
				</span>
			)}
		</div>
	);
}

/**
 * Under a message the server refused, the `at`th: that it was not sent, why
 * on hover, and a way to send it again or back to the composer.
 */
export function UnsentLine({ at }: { at: number }): JSX.Element | null {
	const { unsent, retry, edit } = useContext(UnsentContext);
	const each = unsent[at];
	if (each === undefined) {
		return null;
	}
	const link =
		"text-foreground font-medium underline-offset-2 hover:underline focus-visible:underline";
	return (
		<div
			data-slot="aui_user-message-unsent"
			className="text-muted-foreground -mt-1 flex items-center gap-1 ps-1 text-xs"
		>
			<span
				className="text-destructive flex items-center gap-1"
				title={each.why}
			>
				<CircleAlertIcon className="size-3" aria-hidden />
				Couldn't send
			</span>
			<span aria-hidden>·</span>
			<button
				type="button"
				className={link}
				onClick={() => retry(each.message)}
			>
				Retry
			</button>
			<span aria-hidden>·</span>
			<button type="button" className={link} onClick={() => edit(each.message)}>
				Edit
			</button>
		</div>
	);
}
