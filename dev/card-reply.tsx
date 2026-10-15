import { useAuiState } from "@assistant-ui/react";
import {
	createContext,
	type JSX,
	type ReactNode,
	useContext,
	useEffect,
	useEffectEvent,
} from "react";
import { focusStop } from "#dev/hooks/use-touch.ts";
import { toCardTop } from "./card-shell";

/** What the cards in a conversation answer through. */
export interface Reply {
	/**
	 * Sends `text` as a message of its own, leaving what is typed as it is;
	 * null where nothing can be sent from the page, as to an external agent.
	 */
	send: ((text: string) => Promise<void>) | null;
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
 * What a card answers through while the person has yet to reply to its
 * message, and once they have, the reply they sent. Neither outside a
 * conversation.
 */
export function useCardReply(): { reply: Reply | null; sent: string | null } {
	const live = useContext(ReplyContext);
	const sent = useContext(SentContext);
	return sent === null ? { reply: live, sent: null } : { reply: null, sent };
}

/**
 * Puts the card in `children` in its message: from the person's reply to it
 * on, the card keeps that reply, which nothing changes any more.
 */
export function InMessage({ children }: { children: ReactNode }): JSX.Element {
	const sent = useAuiState((state) => {
		const next = state.thread.messages[state.message.index + 1];
		return next?.role === "user"
			? next.content
					.map((part) => (part.type === "text" ? part.text : ""))
					.join("")
			: null;
	});
	return <SentContext value={sent}>{children}</SentContext>;
}

/**
 * What a card keeps in the conversation's drafts under `name` while it is
 * written, dropped once `sent`; nothing is kept without a name.
 */
export function useKept(
	name: string | null,
	sent: string | null,
): { read(): string; write(text: string): void } {
	const drafts = useContext(ReplyContext)?.drafts ?? null;
	// Sent, from the card or the composer: nothing is left to keep.
	useEffect(() => {
		if (sent !== null && name !== null) {
			drafts?.write(name, "");
		}
	}, [sent, name, drafts]);
	return {
		read: () => (name === null ? "" : (drafts?.read(name) ?? "")),
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
