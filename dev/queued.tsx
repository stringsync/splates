import { type AssistantRuntime, useAuiState } from "@assistant-ui/react";
import { PencilIcon, SendHorizontalIcon, Trash2Icon } from "lucide-react";
import type { JSX, RefObject } from "react";
import { Button } from "#dev/components/ui/button.tsx";
import { Kbd } from "#dev/components/ui/kbd.tsx";
import { useTouch } from "#dev/hooks/use-touch.ts";
import type { Message } from "../conversations";
import { leadingDirectives } from "../prompts";
import { touchButton } from "./board";
import { focusComposer } from "./composer-editor";
import {
	conversationAttachment,
	sendQueuedNow,
	unqueueConversation,
} from "./conversation-api";
import { Directed, DirectiveChip } from "./directives";

/**
 * What the person said while the agent worked, to an agent that cannot take
 * it mid-turn, until the turn ends and it goes out: each one can be taken
 * back to edit or thrown away, and all of them sent now, which stops the turn.
 */
export function Queued({
	conversation,
	messages,
	pending,
	edits,
}: {
	conversation: string;
	messages: Message[];
	/** How many of `messages`, the last ones, the server has yet to record. */
	pending: number;
	/**
	 * How the person changes what waits; null where the page writes nothing,
	 * as to a conversation that answers to another, which shows them only.
	 */
	edits: {
		onEdit: (index: number) => void;
		onDiscard: (index: number) => void;
		onSendNow: () => void;
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
						onClick={edits.onSendNow}
						className={touchButton}
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
					// Still on its way while the agent starts: the server has nothing
					// to take back yet.
					const unrecorded = index >= messages.length - pending;
					return (
						<li
							// Only ever added at the end and taken from anywhere, but
							// each one's words are what the person sees.
							// biome-ignore lint/suspicious/noArrayIndexKey: see above
							key={index}
							className="group/queued flex items-center gap-2 rounded-lg py-1 pr-1 pl-2 hover:bg-foreground/[0.04]"
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
										variant="ghost"
										className="pointer-coarse:size-10"
										aria-label={`Edit ${label}`}
										disabled={unrecorded}
										onClick={() => edits.onEdit(index)}
									>
										<PencilIcon />
									</Button>
									<Button
										size="icon-xs"
										variant="ghost"
										className="pointer-coarse:size-10"
										aria-label={`Discard ${label}`}
										disabled={unrecorded}
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

/**
 * What can be done to the messages `Queued` shows: send them all now, take one
 * back into the composer to edit, or throw one away.
 */
export function useQueueEdits(
	id: string,
	runtime: AssistantRuntime,
	section: RefObject<HTMLElement | null>,
	refused: (title: string, error: unknown) => void,
): QueueEdits {
	// Stops the turn so what is queued goes out now.
	const sendNow = () =>
		sendQueuedNow(id).catch((error: unknown) => refused("Not sent", error));
	// Back into the composer to edit, ahead of anything typed there since.
	const edit = async (index: number) => {
		const taken = await unqueueConversation(id, index).catch(
			(error: unknown) => {
				refused("Not taken back", error);
				return null;
			},
		);
		if (taken === null) {
			return;
		}
		const { text, files } = taken;
		const composer = runtime.thread.composer;
		const typed = composer.getState().text;
		composer.setText(
			typed === "" || text === "" ? `${text}${typed}` : `${text}\n\n${typed}`,
		);
		for (const file of files) {
			void composer.addAttachment(file);
		}
		focusComposer(section.current);
	};
	// Gone before the agent hears it, its words with it.
	const discard = (index: number) =>
		unqueueConversation(id, index).catch((error: unknown) =>
			refused("Not discarded", error),
		);
	return { sendNow, edit, discard };
}

/** What `useQueueEdits` gives a thread. */
export interface QueueEdits {
	sendNow: () => Promise<void>;
	edit: (index: number) => Promise<void>;
	discard: (index: number) => Promise<unknown>;
}
