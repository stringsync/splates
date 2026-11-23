import {
	AssistantRuntimeProvider,
	type ThreadMessageLike,
	useAuiState,
	useExternalStoreRuntime,
} from "@assistant-ui/react";
import type { ConversationState } from "@splates/server/conversations";
import type { Steps } from "@splates/server/plans/browser";
import { useReactive } from "core/react";
import {
	createContext,
	type JSX,
	type ReactNode,
	use,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { ReplyContext, textOf } from "./card-reply";
import { useReply } from "./composer-drafts";
import type { ConversationFeed } from "./conversation-feed";
import type { Drafts } from "./drafts";
import { openPopOut, useFollowLook } from "./pop-out";
import {
	askedFrom,
	askedOnly,
	changedSteps,
	exchangesOf,
	finishedIn,
	versionsIn,
} from "./steps-asked";
import { useStepsPlace } from "./steps-place";
import { InPopout, Popped } from "./steps-popped";
import { useStepPreview } from "./steps-preview";
import { useThreadMessages } from "./thread-messages";
import { useThreadRuntime } from "./thread-runtime";

/** A Steps card popped out: the conversation it is in, and its title. */
export interface PoppedCard {
	conversation: string;
	title: string;
	/** Its steps when popped, shown until the thread is read. */
	steps: Steps;
}

/**
 * The page's one Steps pop-out, for a card to open and close. It stays open
 * whatever the tab shows until closed: by its window, its Close, or `close`.
 */
export interface StepsPopOut {
	/** The card it shows; null while none is popped out. */
	shown: PoppedCard | null;
	/** Pops `card` out, into the window already open when there is one. */
	open: (card: PoppedCard) => Promise<void>;
	close: () => void;
}

export const StepsPopOutContext = createContext<StepsPopOut | null>(null);

/** Whether `card` is the one popped out. */
export function isShown(popOut: StepsPopOut | null, card: PoppedCard): boolean {
	return (
		popOut?.shown?.conversation === card.conversation &&
		popOut.shown.title === card.title
	);
}

/**
 * Holds the page's Steps pop-out: render it once around the pages, with the
 * shown project's conversations as `talk`, and cards inside reach it through
 * `useStepsPopOut`.
 */
export function StepsPopOutHost({
	talk,
	drafts,
	children,
}: {
	talk: ConversationFeed;
	drafts: Drafts;
	children: ReactNode;
}): JSX.Element {
	const [popped, setPopped] = useState<Window | null>(null);
	const [shown, setShown] = useState<
		(PoppedCard & { talk: ConversationFeed }) | null
	>(null);
	useFollowLook(popped);
	const live = useRef<Window | null>(null);
	const open = useCallback(
		async (card: PoppedCard) => {
			if (popped !== null) {
				setShown({ ...card, talk });
				return;
			}
			const opened = await openPopOut(titleOf(card.steps), () => {
				live.current = null;
				setPopped(null);
				setShown(null);
			});
			live.current = opened;
			if (opened !== null) {
				setShown({ ...card, talk });
				setPopped(opened);
			}
		},
		[popped, talk],
	);
	const close = useCallback(() => popped?.close(), [popped]);
	// Closed with the page, never before.
	useEffect(() => () => live.current?.close(), []);
	useEffect(() => {
		if (popped !== null && shown !== null) {
			popped.document.title = titleOf(shown.steps);
		}
	}, [popped, shown]);
	// The page stops streaming a project it no longer shows; the pop-out keeps
	// the one it shows going, until it closes.
	const held = shown?.talk ?? null;
	useEffect(() => {
		if (held === null || held === talk) {
			return;
		}
		held.start();
		return () => held.dispose();
	}, [held, talk]);
	const value = useMemo(() => ({ shown, open, close }), [shown, open, close]);
	return (
		<StepsPopOutContext value={value}>
			{children}
			{popped !== null &&
				shown !== null &&
				createPortal(
					<PoppedConversation
						key={`${shown.conversation}:${shown.title}`}
						card={shown}
						talk={shown.talk}
						drafts={drafts}
						window={popped}
						onClose={close}
					/>,
					popped.document.body,
				)}
		</StepsPopOutContext>
	);
}

function titleOf(steps: Steps): string {
	return steps.title === "" ? "Steps" : `Steps: ${steps.title}`;
}

/** The popped card's conversation, read whole, with a thread of its own. */
function PoppedConversation({
	card,
	talk,
	drafts,
	window: popped,
	onClose,
}: {
	card: PoppedCard;
	talk: ConversationFeed;
	drafts: Drafts;
	window: Window;
	onClose: () => void;
}): JSX.Element {
	const conversation = useReactive(
		talk,
		(talk) => talk.current(card.conversation),
		["changed"],
	);
	if (conversation === undefined) {
		return <Alone card={card} window={popped} onClose={onClose} />;
	}
	return (
		<PoppedThread
			card={card}
			conversation={conversation}
			talk={talk}
			drafts={drafts}
			window={popped}
			onClose={onClose}
		/>
	);
}

const NOTHING_REFUSED = () => {};

function PoppedThread({
	card,
	conversation,
	talk,
	drafts,
	window: popped,
	onClose,
}: {
	card: PoppedCard;
	conversation: ConversationState;
	talk: ConversationFeed;
	drafts: Drafts;
	window: Window;
	onClose: () => void;
}): JSX.Element {
	const { id, summary } = conversation;
	// Listings hold a summary; the thread needs the conversation whole.
	useEffect(() => {
		if (summary === true) {
			void talk.whole(id).catch(() => {});
		}
	}, [talk, id, summary]);
	const thread = useThreadMessages(conversation, talk);
	const { versions, finished } = useMemo(
		() => ({
			versions: versionsIn(thread.messages, card.title),
			finished: finishedIn(thread.messages, card.title),
		}),
		[thread.messages, card.title],
	);
	const newest = versions.at(-1) ?? card.steps;
	const before = versions.at(-2) ?? null;
	const changed = useMemo(() => changedSteps(before, newest), [before, newest]);
	const [done, place, move] = useStepsPlace(newest);
	const [preview, togglePreview] = useStepPreview(done, newest.steps.length);
	// The pop-out's chat is the conversation's own thread, holding only what
	// was asked from here and the answers.
	const asked = useMemo(() => {
		const messages = askedOnly(thread.messages, card.title);
		const last = messages.at(-1);
		return {
			...thread,
			messages,
			hasEarlier: false,
			running:
				thread.running && last !== undefined && last === thread.messages.at(-1),
		};
	}, [thread, card.title]);
	const reading = preview ?? done;
	const wrap = useCallback(
		(words: string) => askedFrom(newest, reading, words),
		[newest, reading],
	);
	const { runtime, send } = useThreadRuntime(
		conversation,
		talk,
		drafts,
		asked,
		NOTHING_REFUSED,
		{ draft: `${id}:steps-popout:${card.title}`, asked: wrap },
	);
	const reply = useReply(id, drafts, send);
	return (
		<AssistantRuntimeProvider runtime={runtime}>
			<ReplyContext value={reply}>
				<InPopout value>
					<FromThread
						title={card.title}
						steps={newest}
						done={done}
						place={place}
						move={move}
						preview={preview}
						togglePreview={togglePreview}
						changed={changed}
						versions={versions.length}
						finished={finished}
						window={popped}
						onClose={onClose}
					/>
				</InPopout>
			</ReplyContext>
		</AssistantRuntimeProvider>
	);
}

/** The pop-out over its thread: what was asked from it, read from the thread. */
function FromThread({
	title,
	...props
}: Omit<Parameters<typeof Popped>[0], "exchanges" | "last"> & {
	title: string;
}): JSX.Element {
	const messages = useAuiState((state) => state.thread.messages);
	const running = useAuiState((state) => state.thread.isRunning);
	const { exchanges, last } = useMemo(() => {
		const exchanges = exchangesOf(messages, title, running);
		const answer = exchanges
			.findLast((each) => each.messages.length > 1)
			?.messages.at(-1);
		const message = answer === undefined ? undefined : messages[answer];
		const said = message === undefined ? "" : textOf(message);
		return {
			exchanges,
			last: said.split("\n").find((line) => line.trim() !== "") ?? null,
		};
	}, [messages, running, title]);
	return <Popped {...props} exchanges={exchanges} last={last} />;
}

/** The steps alone, for a conversation the page no longer holds. */
function Alone({
	card,
	window: popped,
	onClose,
}: {
	card: PoppedCard;
	window: Window;
	onClose: () => void;
}): JSX.Element {
	const [done, place, move] = useStepsPlace(card.steps);
	const [preview, togglePreview] = useStepPreview(
		done,
		card.steps.steps.length,
	);
	// An empty thread, with nothing to send it to.
	const runtime = useExternalStoreRuntime({
		messages: NO_MESSAGES,
		convertMessage: (message: ThreadMessageLike) => message,
		onNew: async () => {},
	});
	return (
		<AssistantRuntimeProvider runtime={runtime}>
			<InPopout value>
				<Popped
					steps={card.steps}
					done={done}
					place={place}
					move={move}
					preview={preview}
					togglePreview={togglePreview}
					changed={NO_CHANGES}
					exchanges={[]}
					last={null}
					versions={1}
					window={popped}
					onClose={onClose}
				/>
			</InPopout>
		</AssistantRuntimeProvider>
	);
}

const NO_MESSAGES: ThreadMessageLike[] = [];

const NO_CHANGES: ReadonlyMap<number, string | null> = new Map();

/** The page's pop-out, for a card to open and close. */
export function useStepsPopOut(): StepsPopOut | null {
	return use(StepsPopOutContext);
}
