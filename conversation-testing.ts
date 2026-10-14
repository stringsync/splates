import type * as acp from "@agentclientprotocol/sdk";
import type { Conversation, Conversations, Status } from "./conversations";

/** A turn the fake agent holds open until `finish` is called with how it ended. */
export interface Held {
	finish?: (reason: acp.StopReason) => void;
}

/** Settles once `conversation` has `status`; a test that never sees it times out. */
export function until(
	conversation: Conversation,
	status: Status,
): Promise<void> {
	return once(conversation, () => conversation.state.status === status);
}

/** Settles once `done` holds of `conversation`; a test that never sees it times out. */
export function once(
	conversation: Conversation,
	done: () => boolean,
): Promise<void> {
	return new Promise<void>((resolve) => {
		const check = () => {
			if (done()) {
				off();
				resolve();
			}
		};
		const off = conversation.events.on("changed", check);
		check();
	});
}

/**
 * Starts a conversation on task login, runs a turn on "one", and waits until
 * the agent holds it in `held`.
 */
export async function working(
	conversations: Conversations,
	held: Held,
): Promise<Conversation> {
	const conversation = await conversations.start("fake", {
		task: "login",
		cwd: "/repo-arbor/login",
	});
	await until(conversation, "idle");
	await conversation.prompt("one");
	await eventually(() => held.finish !== undefined);
	return conversation;
}

/** Settles once `done` holds, or after a hundred tries a millisecond apart. */
export async function eventually(done: () => boolean): Promise<void> {
	for (let i = 0; i < 100 && !done(); i++) {
		await Bun.sleep(1);
	}
}

/** Ends the turn `held`, and waits for `conversation` to be idle. */
export async function finish(
	conversation: Conversation,
	held: Held,
): Promise<void> {
	const finishing = held.finish;
	held.finish = undefined;
	finishing?.("end_turn");
	await until(conversation, "idle");
}

/** What each message of `conversation` says, and whether it is still queued. */
export function thread(conversation: Conversation): [string, boolean][] {
	return conversation.state.messages.map((each) => [
		each.parts.map((part) => (part.type === "text" ? part.text : "")).join(""),
		each.queued ?? false,
	]);
}
