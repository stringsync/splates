import { useAuiState } from "@assistant-ui/react";
import type { Message } from "@stringsync/splates-server/conversations";
import { leadingDirectives } from "@stringsync/splates-server/plans/browser";
import { Duration, SystemTimer, SystemWallClock } from "core/time";
import {
	CircleAlertIcon,
	PencilIcon,
	SendHorizontalIcon,
	Trash2Icon,
} from "lucide-react";
import { type JSX, useContext, useEffect, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { Kbd } from "#web/components/ui/kbd.tsx";
import { useTouch } from "#web/hooks/use-touch.ts";
import { conversationAttachment } from "./conversation-api";
import { Directed, DirectiveChip } from "./directives";
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

/** What the row's buttons do with the messages the server holds for the agent. */
export interface HeldEdits {
	conversation: string;
	onEdit: (index: number, message: Message) => void;
	onDiscard: (index: number) => void;
	/** Null while the agent is not yet up to be stopped: held or starting. */
	onSendNow: (() => void) | null;
	/** Sending or discarding is on its way: held until the server answers. */
	busy: boolean;
}

/**
 * Above the composer, the messages said to the conversation that have waited
 * past a few seconds without reaching the agent, in the order said, dimmed
 * with their Sending line: those its server has yet to record, those it holds
 * for the agent, which can be edited, discarded or sent now, and those it
 * refused. Before that they look sent, in the thread.
 */
export function PendingRow({
	messages,
	unsent,
	held = [],
	edits = null,
	retry,
	edit,
}: {
	messages: readonly Sending[];
	unsent: readonly Unsent[];
	held?: readonly Message[];
	edits?: HeldEdits | null;
	retry: (message: Sending) => void;
	edit: (message: Sending) => void;
}): JSX.Element | null {
	// Enter sends what is held only with nothing typed.
	const empty = useAuiState((state) => state.composer.isEmpty);
	const touch = useTouch();
	if (messages.length === 0 && unsent.length === 0 && held.length === 0) {
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
				<li key={message.id} className="flex flex-col gap-0.5 pr-1 pl-2">
					<div className="flex items-start gap-2">
						{message.images.map((image) => (
							<img
								key={image.name}
								src={image.url}
								alt=""
								className="size-6 shrink-0 rounded object-cover ring-1 ring-foreground/10"
							/>
						))}
						<span
							data-slot="aui_user-message-pending-text"
							className="min-w-0 flex-1 cursor-text select-text whitespace-pre-wrap break-words text-sm"
						>
							{message.text ||
								[...message.images, ...message.files]
									.map((each) => each.name)
									.join(", ")}
						</span>
					</div>
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
			{held.map((message, index) => (
				<HeldItem
					// Only ever added at the end and taken from anywhere, but
					// each one's words are what the person sees.
					// biome-ignore lint/suspicious/noArrayIndexKey: see above
					key={index}
					message={message}
					index={index}
					edits={edits}
					showEnter={empty && !touch && index === 0}
				/>
			))}
		</ul>
	);
}

/** A message the server holds for the agent: its words, a Sending line, and what can be done with it. */
function HeldItem({
	message,
	index,
	edits,
	showEnter,
}: {
	message: Message;
	index: number;
	edits: HeldEdits | null;
	showEnter: boolean;
}): JSX.Element {
	const text = message.parts
		.map((part) => (part.type === "text" ? part.text : ""))
		.join("");
	const images = message.parts.flatMap((part) =>
		part.type === "image" ? [part] : [],
	);
	const files = message.parts.flatMap((part) =>
		part.type === "file" ? [part] : [],
	);
	const { directives, rest } = leadingDirectives(text);
	const sent = images.length + files.length;
	const label =
		text ||
		(files.length === 0
			? images.length === 1
				? "an image"
				: `${images.length} images`
			: sent === 1
				? (files[0]?.title ?? "a file")
				: `${sent} files`);
	return (
		<li className="flex flex-col gap-0.5 pr-1 pl-2">
			<div className="flex items-center gap-2">
				{images.map((image) => (
					<img
						key={image.name}
						src={
							edits === null
								? undefined
								: conversationAttachment(edits.conversation, image)
						}
						alt=""
						className="size-6 shrink-0 rounded object-cover ring-1 ring-foreground/10"
					/>
				))}
				{directives.map((directive) => (
					<DirectiveChip key={directive} directive={directive} />
				))}
				<span className="min-w-0 flex-1 truncate text-sm">
					<Directed text={rest} />
				</span>
				{edits !== null && (
					<>
						{index === 0 && edits.onSendNow != null && (
							<Button
								size="xs"
								variant="outline"
								disabled={edits.busy}
								onClick={edits.onSendNow}
							>
								<SendHorizontalIcon />
								Send now
								{showEnter && <Kbd className="-mr-1 h-4 bg-transparent">↵</Kbd>}
							</Button>
						)}
						<Button
							size="icon-xs"
							variant="outline"
							className="pointer-coarse:size-10"
							aria-label={`Edit ${label}`}
							onClick={() => edits.onEdit(index, message)}
						>
							<PencilIcon />
						</Button>
						<Button
							size="icon-xs"
							variant="outline"
							className="pointer-coarse:size-10"
							aria-label={`Discard ${label}`}
							disabled={edits.busy}
							onClick={() => edits.onDiscard(index)}
						>
							<Trash2Icon />
						</Button>
					</>
				)}
			</div>
			<div className="text-muted-foreground text-xs">Sending…</div>
		</li>
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
