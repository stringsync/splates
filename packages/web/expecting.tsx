import type { ConversationState } from "@stringsync/splates-server/conversations";
import { createContext, type JSX, type ReactNode, use } from "react";
import { Held } from "./handed-out";
import { useRefusals } from "./refusal";
import { RowRefusals } from "./row-refusal";

/**
 * What a write is to change of a conversation, shown before the server says
 * so: the fields it sets, or how it turns the conversation as the server last
 * said into what it will say.
 */
export type Expectation =
	| Partial<ConversationState>
	| ((state: ConversationState) => ConversationState);

/** What shows a change to a conversation before the server says so. */
export interface Expecter {
	/**
	 * Shows `expectation` over conversation `id` at once, while `write`, the
	 * request that makes it, is on its way; rejects as `write` does, once the
	 * change no longer shows, for the caller to say why.
	 */
	expect(
		id: string,
		expectation: Expectation,
		write: Promise<unknown>,
	): Promise<void>;
}

/**
 * The conversation feed, for the controls that change a conversation to
 * show the change at once. Without one, as outside the conversations, a
 * change waits for its write as before.
 */
const Expecting = createContext<Expecter>({
	async expect(_id, _expectation, write) {
		await write;
	},
});

/** Shows a change to a conversation at once, while its write is on its way. */
export function useExpect(): Expecter["expect"] {
	const expecter = use(Expecting);
	return (id, expectation, write) => expecter.expect(id, expectation, write);
}

/**
 * Gives every list of conversations below what it reads of them: `held`, as
 * the page last showed them, `feed` to show a change at once, and the
 * refusals said under each row, kept here so a row that goes and comes back,
 * as a refused archive does, still says why.
 */
export function Talking({
	feed,
	held,
	children,
}: {
	feed: Expecter;
	held: readonly ConversationState[];
	children: ReactNode;
}): JSX.Element {
	const refusals = useRefusals<string>();
	return (
		<Held value={held}>
			<Expecting value={feed}>
				<RowRefusals value={refusals}>{children}</RowRefusals>
			</Expecting>
		</Held>
	);
}
