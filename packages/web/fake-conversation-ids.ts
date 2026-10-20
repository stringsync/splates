import type { IdProvider } from "webappwiz/id";

/** The fake server, for what a write answers with. */
export interface Replying {
	readonly reply: unknown;
}

/**
 * Names each conversation the page starts with the id `server.reply` holds,
 * as a test sets the server's answer before a start, since the server keeps
 * the id the page picks; a random one when it holds none.
 */
export class RepliedIds implements IdProvider {
	constructor(private readonly server: Replying) {}

	next(): string {
		const { reply } = this.server;
		return typeof reply === "object" &&
			reply !== null &&
			"id" in reply &&
			typeof reply.id === "string"
			? reply.id
			: crypto.randomUUID();
	}
}
