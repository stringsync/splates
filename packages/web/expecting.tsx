import type { ConversationState } from "@stringsync/splates-server/conversations";
import type { Snapshot } from "@stringsync/splates-server/tasks";
import {
	createContext,
	type JSX,
	type ReactNode,
	use,
	useCallback,
	useSyncExternalStore,
} from "react";
import type { ConversationFeed } from "./conversation-feed";
import { HeldFeed } from "./handed-out";
import { useRefusals } from "./refusal";
import { RowRefusals } from "./row-refusal";

/**
 * What a write is to change of a conversation: the fields it sets, or how it
 * turns the conversation as the server last said into what it will say. It is
 * never drawn, only read to know when the server's copy shows the change.
 */
export type Expectation =
	| Partial<ConversationState>
	| ((state: ConversationState) => ConversationState);

/** What holds a write to a conversation as pending until the server shows it. */
export interface Expecter {
	/**
	 * Holds conversation `id` as pending while `write`, the request that makes
	 * it, is on its way and until the server's copy holds `expectation`;
	 * rejects as `write` does, once it is no longer pending, for the caller to
	 * say why.
	 */
	expect(
		id: string,
		expectation: Expectation,
		write: Promise<unknown>,
	): Promise<void>;
	/** Whether a write to conversation `id` is pending. */
	pending(id: string): boolean;
	/** Calls `changed` when anything pending may have; returns how to stop. */
	subscribe(changed: () => void): () => void;
}

/**
 * The conversation feed, for the controls that change a conversation to
 * hold it pending. Without one, as outside the conversations, a change waits
 * for its write and nothing is pending.
 */
const Expecting = createContext<Expecter>({
	async expect(_id, _expectation, write) {
		await write;
	},
	pending: () => false,
	subscribe: () => () => {},
});

/** Holds a conversation pending while its write is on its way and unseen. */
export function useExpect(): Expecter["expect"] {
	const expecter = use(Expecting);
	return useCallback(
		(id, expectation, write) => expecter.expect(id, expectation, write),
		[expecter],
	);
}

/** What holds a write to the board, or any of the repo's snapshot, as pending until the server shows it. */
export interface SnapshotExpecter {
	/**
	 * Holds `key`, what the write touches (a task, todo or lane), as pending
	 * while `write` is on its way and until the server's snapshot holds
	 * `expectation`, how `write` turns the snapshot as the server last said
	 * it; rejects as `write` does, once it is no longer pending, for the
	 * caller to say why.
	 */
	expect(
		expectation: (snapshot: Snapshot) => Snapshot,
		write: Promise<unknown>,
		key?: string,
	): Promise<void>;
	/** Whether a write is pending, under `key` when given. */
	pending(key?: string): boolean;
	/** Calls `changed` when anything pending may have; returns how to stop. */
	subscribe(changed: () => void): () => void;
}

/**
 * The snapshot feed, for the controls that change the board to hold it
 * pending. Without one, a change waits for its write and nothing is pending.
 */
export const SnapshotExpecting = createContext<SnapshotExpecter>({
	async expect(_expectation, write) {
		await write;
	},
	pending: () => false,
	subscribe: () => () => {},
});

/** Holds a change to the snapshot pending while its write is on its way and unseen. */
export function useExpectSnapshot(): SnapshotExpecter["expect"] {
	const expecter = use(SnapshotExpecting);
	return useCallback(
		(expectation, write, key) => expecter.expect(expectation, write, key),
		[expecter],
	);
}

/** Whether a write to the snapshot is pending, under `key` when given. */
export function usePendingSnapshot(key?: string): boolean {
	const expecter = use(SnapshotExpecting);
	const read = useCallback(() => expecter.pending(key), [expecter, key]);
	return useSyncExternalStore(expecter.subscribe.bind(expecter), read, read);
}

/** Whether a write to conversation `id` is pending: the server has yet to show it. */
export function usePendingConversation(id: string): boolean {
	const expecter = use(Expecting);
	const read = useCallback(() => expecter.pending(id), [expecter, id]);
	return useSyncExternalStore(expecter.subscribe.bind(expecter), read, read);
}

/**
 * Gives every list of conversations below what it reads of them: `held`, as
 * the page last showed them, `feed` to show a change at once, and the
 * refusals said under each row, kept here so a row that goes and comes back,
 * as a refused archive does, still says why.
 */
export function Talking({
	feed,
	children,
}: {
	feed: ConversationFeed;
	children: ReactNode;
}): JSX.Element {
	const refusals = useRefusals<string>();
	return (
		<HeldFeed value={feed}>
			<Expecting value={feed}>
				<RowRefusals value={refusals}>{children}</RowRefusals>
			</Expecting>
		</HeldFeed>
	);
}
