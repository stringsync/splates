import type { Conversation } from "./conversation";

/** What a reader of a project's conversations asks of them. */
export interface ConversationList {
	list(): Promise<Conversation[]>;
}

/** The conversations of a project that has none. */
export class NoopConversations implements ConversationList {
	async list(): Promise<Conversation[]> {
		return [];
	}

	async disposeAsync(): Promise<void> {}
}
