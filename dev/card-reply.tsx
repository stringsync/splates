import { type ThreadMessage, useAuiState } from "@assistant-ui/react";
import {
	createContext,
	type JSX,
	type ReactNode,
	useContext,
	useEffect,
	useEffectEvent,
} from "react";
import { focusStop } from "#dev/hooks/use-touch.ts";
import { type Event, isEscalation } from "../events";
import { isUpdate } from "../prompts";
import { toCardTop } from "./card-shell";

/** What the cards in a conversation answer through. */
export interface Reply {
	/**
	 * Sends `text` as a message of its own, with `files` attached, leaving what
	 * is typed as it is; null where nothing can be sent from the page, as to
	 * an external agent.
	 */
	send: ((text: string, files?: readonly File[]) => Promise<void>) | null;
	/**
	 * Where a card keeps what is written in it and not sent, under a name of
	 * its own in the conversation, so leaving and coming back loses nothing.
	 */
	drafts: {
		read(name: string): string;
		write(name: string, text: string): void;
	};
}

/** The open conversation's; none outside one, where cards only show. */
export const ReplyContext = createContext<Reply | null>(null);

/**
 * The reply the person sent to the message a card is in, or null while they
 * have yet to: what `InMessage` reads from the thread.
 */
const SentContext = createContext<string | null>(null);

/**
 * Whether the agent asked again in a later message before the person replied:
 * what `InMessage` reads from the thread.
 */
const AskedAgainContext = createContext(false);

/**
 * What a card answers through while the person has yet to reply to its
 * message, and once they have, the reply they sent. Neither outside a
 * conversation, nor once the agent asked again in a later message, which
 * `askedAgain` says.
 */
export function useCardReply(): {
	reply: Reply | null;
	sent: string | null;
	askedAgain: boolean;
} {
	const live = useContext(ReplyContext);
	const sent = useContext(SentContext);
	const askedAgain = useContext(AskedAgainContext);
	return sent === null
		? { reply: askedAgain ? null : live, sent: null, askedAgain }
		: { reply: null, sent, askedAgain: false };
}

/** The parts of a message that ask the person something, by name. */
const ASKING = ["questions", "review"];

/**
 * Puts the card in `children` in its message: from the person's reply to it
 * on, the card keeps that reply, which nothing changes any more. Arbor's own
 * updates in between, such as a task's report, are no reply. Before one, a
 * later message that asks the person something itself takes over from it.
 */
export function InMessage({ children }: { children: ReactNode }): JSX.Element {
	// One message on from its own: the reply, or the ask that takes over.
	const after = useAuiState((state) =>
		state.thread.messages
			.slice(state.message.index + 1)
			.findIndex(
				(next) =>
					(next.role === "user" && !isUpdate(textOf(next))) ||
					(next.role === "assistant" && asks(next)),
			),
	);
	const next = useAuiState((state) =>
		after === -1
			? null
			: state.thread.messages[state.message.index + 1 + after],
	);
	const sent = next?.role === "user" ? textOf(next) : null;
	return (
		<SentContext value={sent}>
			<AskedAgainContext value={next?.role === "assistant"}>
				{children}
			</AskedAgainContext>
		</SentContext>
	);
}

/** Whether `event` is an escalation asking for a review. */
function isReview(event: Event): boolean {
	return isEscalation(event) && event.review;
}

/**
 * Whether the person's message at `index` is the reply to a review: the first
 * of theirs, past arbor's updates, after a message asking with one.
 */
export function repliesToReview(
	messages: readonly ThreadMessage[],
	index: number,
): boolean {
	for (let at = index - 1; at >= 0; at -= 1) {
		const message = messages[at] as ThreadMessage;
		if (message.role === "user" && !isUpdate(textOf(message))) {
			return false;
		}
		if (message.role === "assistant" && asks(message)) {
			return message.content.some(
				(part) =>
					part.type === "data" &&
					(part.name === "review" ||
						(part.name === "event" &&
							isReview((part.data as { event: Event }).event))),
			);
		}
	}
	return false;
}

/** The words of `message`, without its files. */
export function textOf(message: ThreadMessage): string {
	return message.content
		.map((part) => (part.type === "text" ? part.text : ""))
		.join("");
}

/**
 * Whether `message` asks the person something, as questions or a review, or
 * as an escalation arbor recorded.
 */
export function asks(message: ThreadMessage): boolean {
	return message.content.some(
		(part) =>
			part.type === "data" &&
			(ASKING.includes(part.name) ||
				(part.name === "event" &&
					isEscalation((part.data as { event: Event }).event))),
	);
}

/**
 * What a card keeps in the conversation's drafts under `name` while it is
 * written, dropped once `sent`; nothing is kept without a name. While it
 * holds nothing, it reads the first of the drafts `before` that holds
 * anything, as for a card asked again.
 */
export function useKept(
	name: string | null,
	sent: string | null,
	before: string[] = [],
): { read(): string; write(text: string): void } {
	const drafts = useContext(ReplyContext)?.drafts ?? null;
	// Sent, from the card or the composer: nothing is left to keep.
	useEffect(() => {
		if (sent !== null && name !== null) {
			drafts?.write(name, "");
		}
	}, [sent, name, drafts]);
	return {
		read: () => {
			if (name === null || drafts === null) {
				return "";
			}
			for (const each of [name, ...before]) {
				const text = drafts.read(each);
				if (text !== "") {
					return text;
				}
			}
			return "";
		},
		write: (text) => {
			if (name !== null) {
				drafts?.write(name, text);
			}
		},
	};
}

/**
 * Focuses what `first` finds as a card comes up to be answered, which the
 * composer leaves to it, and scrolls the card to its top, unless the person
 * is typing elsewhere, as in a composer holding a draft, or is in a dialog,
 * such as the open questions'.
 */
export function useArrival(
	live: boolean,
	first: () => HTMLElement | null | undefined,
): void {
	const arrive = useEffectEvent(() => {
		const typing = document.activeElement;
		if (typing?.closest('[role="dialog"]') != null) {
			return;
		}
		if (
			((typing instanceof HTMLTextAreaElement ||
				typing instanceof HTMLInputElement) &&
				typing.value !== "") ||
			(typing instanceof HTMLElement &&
				typing.isContentEditable &&
				typing.textContent !== "")
		) {
			return;
		}
		const stop = first();
		focusStop(stop, { preventScroll: true });
		const card = stop?.closest<HTMLElement>("[data-card]");
		if (card != null) {
			toCardTop(card);
		}
	});
	useEffect(() => {
		if (live) {
			arrive();
		}
	}, [live]);
}
