import { type AssistantRuntime, useAuiState } from "@assistant-ui/react";
import type {
	ConversationState,
	Message,
} from "@stringsync/splates-server/conversations";
import { textOf } from "@stringsync/splates-server/conversations/browser";
import { leadingDirectives } from "@stringsync/splates-server/plans/browser";
import { PencilIcon, SendHorizontalIcon, Trash2Icon } from "lucide-react";
import type { JSX, RefObject } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { Kbd } from "#web/components/ui/kbd.tsx";
import { useTouch } from "#web/hooks/use-touch.ts";
import { focusComposer } from "./composer-editor";
import {
	conversationAttachment,
	sendQueuedNow,
	unqueueConversation,
} from "./conversation-api";
import { Directed, DirectiveChip } from "./directives";
import { useExpect, usePendingConversation } from "./expecting";

/** What waits for a running turn's end, above the composer. */
export function Queued({
	conversation,
	messages,
	edits,
}: {
	conversation: string;
	messages: Message[];
	edits: {
		onEdit: (index: number, message: Message) => void;
		onDiscard: (index: number) => void;
		onSendNow: () => void;
		/** Sending or discarding is on its way: held until the server answers. */
		busy: boolean;
	} | null;
}): JSX.Element {
	// Enter sends the queue only with nothing typed; otherwise it queues what is.
	const empty = useAuiState((state) => state.composer.isEmpty);
	const touch = useTouch();
	return (
		<section
			aria-label="queued messages"
			className="mb-2 flex flex-col gap-1 rounded-2xl border bg-muted/50 p-2"
		>
			<header className="flex items-center gap-2 pl-2">
				<h3 className="flex-1 text-muted-foreground text-xs">
					Queued for when the agent's turn ends
				</h3>
				{edits !== null && (
					<Button
						size="sm"
						variant="outline"
						disabled={edits.busy}
						onClick={edits.onSendNow}
					>
						<SendHorizontalIcon />
						Send now
						{empty && !touch && (
							<Kbd className="-mr-1 h-4 bg-transparent">↵</Kbd>
						)}
					</Button>
				)}
			</header>
			<ul className="flex flex-col">
				{messages.map((message, index) => {
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
						<li
							// Only ever added at the end and taken from anywhere, but
							// each one's words are what the person sees.
							// biome-ignore lint/suspicious/noArrayIndexKey: see above
							key={index}
							className="flex items-center gap-2 rounded-lg py-1 pr-1 pl-2"
						>
							{images.map((image) => (
								<img
									key={image.name}
									src={conversationAttachment(conversation, image)}
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
						</li>
					);
				})}
			</ul>
		</section>
	);
}

/** Send queued messages now, take one back to edit, or throw one away. */
export function useQueueEdits(
	id: string,
	runtime: AssistantRuntime,
	section: RefObject<HTMLElement | null>,
	refused: (title: string, error: unknown) => void,
): QueueEdits {
	// One pending write per conversation, shared with the halted Send, so
	// no two of its buttons are in flight at once.
	const expect = useExpect();
	const pending = usePendingConversation(id);
	const unchanged = (state: ConversationState) => state;
	// Stops the turn so what is queued goes out now.
	const sendNow = () =>
		pending
			? Promise.resolve()
			: expect(id, unchanged, sendQueuedNow(id)).catch((error: unknown) =>
					refused("Not sent", error),
				);
	// Back into the composer to edit, ahead of anything typed there since: once
	// the server has taken it back, its words and files together, so the
	// composer never shows a message the server still holds.
	const edit = async (index: number, message: Message) => {
		if (pending) {
			return;
		}
		const request = unqueueConversation(id, index);
		const taken = await expect(id, unchanged, request)
			.then(() => request)
			.catch((error: unknown) => {
				refused("Not taken back", error);
				return null;
			});
		if (taken === null) {
			return;
		}
		const text = textOf(message);
		const composer = runtime.thread.composer;
		const typed = composer.getState().text;
		composer.setText(
			typed === "" || text === "" ? `${text}${typed}` : `${text}\n\n${typed}`,
		);
		focusComposer(section.current);
		for (const file of taken.files ?? []) {
			void composer.addAttachment(file);
		}
	};
	// Gone before the agent hears it, its words with it.
	const discard = (index: number) =>
		pending
			? Promise.resolve()
			: expect(id, unchanged, unqueueConversation(id, index)).catch(
					(error: unknown) => refused("Not discarded", error),
				);
	return { sendNow, edit, discard, busy: pending };
}

/** What `useQueueEdits` gives a thread. */
export interface QueueEdits {
	sendNow: () => Promise<void>;
	edit: (index: number, message: Message) => Promise<void>;
	discard: (index: number) => Promise<unknown>;
	/** Sending or discarding is on its way. */
	busy: boolean;
}

/** Keyboard shortcuts for the queue above the composer. */
export function queueKeyDown(
	event: React.KeyboardEvent<HTMLElement>,
	runtime: AssistantRuntime,
	{
		queued,
		running,
		pending,
		touch,
		sendNow,
		edit,
	}: {
		queued: Message[];
		running: boolean;
		/** A message of the person's is still on its way, behind what is queued. */
		pending: boolean;
		touch: boolean;
		sendNow: () => void;
		edit: QueueEdits["edit"];
	},
): void {
	const box = event.target as HTMLElement;
	const last = queued.at(-1);
	if (
		event.key === "Enter" &&
		!touch &&
		!event.shiftKey &&
		box.getAttribute("aria-label") === "Message input" &&
		runtime.thread.composer.getState().text === "" &&
		running &&
		queued.length > 0
	) {
		event.preventDefault();
		event.stopPropagation();
		void sendNow();
		return;
	}
	if (
		event.key === "ArrowUp" &&
		box.getAttribute("aria-label") === "Message input" &&
		runtime.thread.composer.getState().text === "" &&
		last !== undefined &&
		!pending
	) {
		event.preventDefault();
		void edit(queued.length - 1, last);
	}
}
