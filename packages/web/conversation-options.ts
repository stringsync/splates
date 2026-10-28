import type { ConversationState } from "@stringsync/splates-server/conversations";
import type { IdProvider } from "webappwiz/id";
import type { AgentChoice } from "./agent-choice";
import type { PageCopy } from "./page-copy";

/** What the page keeps of a listing, to draw from at once when opened again. */
export interface Listing {
	agents: AgentChoice[];
	conversations: ConversationState[];
}

/** Where a `ConversationFeed` keeps its listing, and which project it reads. */
export interface ConversationFeedOptions {
	copy?: PageCopy<Listing> | null;
	project?: string | null;
	/** What names each conversation the page starts. */
	conversationIds?: IdProvider;
}
