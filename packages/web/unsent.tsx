import { CircleAlertIcon } from "lucide-react";
import { type JSX, useContext, useEffect, useState } from "react";
import { Duration, SystemTimer, SystemWallClock } from "webappwiz/time";
import { HeldFeed } from "./handed-out";
import { useShowPending } from "./pending";
import {
	SEND_TIMEOUT,
	type Sending,
	STILL_SENDING,
	type Unsent,
} from "./sending";

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
 * Above the composer, the messages said to the conversation that its server
 * has yet to record, in the order said, dimmed with their Sending line. They
 * wait here whichever way the server places them, and its own copy of each
 * appears where it puts it.
 */
export function PendingRow({
	messages,
	unsent,
	retry,
	edit,
}: {
	messages: readonly Sending[];
	unsent: readonly Unsent[];
	retry: (message: Sending) => void;
	edit: (message: Sending) => void;
}): JSX.Element | null {
	if (messages.length === 0 && unsent.length === 0) {
		return null;
	}
	return (
		<ul
			aria-label="messages sending"
			className="mb-2 flex flex-col gap-1 rounded-2xl border bg-muted/50 p-2 opacity-70"
		>
			{[
				...unsent.map((each) => ({ message: each.message, why: each.why })),
				...messages.map((message) => ({ message, why: null })),
			].map(({ message, why }) => (
				<li key={message.id} className="flex items-center gap-2 pr-1 pl-2">
					{message.images.map((image) => (
						<img
							key={image.name}
							src={image.url}
							alt=""
							className="size-6 shrink-0 rounded object-cover ring-1 ring-foreground/10"
						/>
					))}
					<span className="min-w-0 flex-1 truncate text-sm">
						{message.text ||
							[...message.images, ...message.files]
								.map((each) => each.name)
								.join(", ")}
					</span>
					{why === null ? (
						<SendingLine since={message.at} />
					) : (
						<RefusedLine
							why={why}
							onRetry={() => retry(message)}
							onEdit={() => edit(message)}
						/>
					)}
				</li>
			))}
		</ul>
	);
}

/** Beside a refused message: that it was not sent, why on hover, and a way to send it again or back to the composer. */
function RefusedLine({
	why,
	onRetry,
	onEdit,
}: {
	why: string;
	onRetry: () => void;
	onEdit: () => void;
}): JSX.Element {
	const link =
		"text-foreground font-medium underline-offset-2 hover:underline focus-visible:underline";
	return (
		<div
			data-slot="aui_user-message-unsent"
			className="text-muted-foreground flex shrink-0 items-center gap-1 text-xs"
		>
			<span className="text-destructive flex items-center gap-1" title={why}>
				<CircleAlertIcon className="size-3" aria-hidden />
				Couldn't send
			</span>
			<span aria-hidden>·</span>
			<button type="button" className={link} onClick={onRetry}>
				Retry
			</button>
			<span aria-hidden>·</span>
			<button type="button" className={link} onClick={onEdit}>
				Edit
			</button>
		</div>
	);
}
