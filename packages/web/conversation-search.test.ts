import { describe, expect, it } from "bun:test";
import type { Said } from "@stringsync/splates-server/conversations";
import { FakeTimer } from "webappwiz/time/testing";
import { ConversationSearch, type WordsServer } from "./conversation-search";

/** A server that answers each search as `answers` says, once released. */
class FakeWordsServer implements WordsServer {
	readonly asked: string[] = [];
	private readonly pending: (() => void)[] = [];

	constructor(private readonly answers: Record<string, Record<string, Said>>) {}

	search(query: string): Promise<Record<string, Said>> {
		this.asked.push(query);
		return new Promise((resolve) => {
			this.pending.push(() => resolve(this.answers[query] ?? {}));
		});
	}

	answerAll(): void {
		for (const answer of this.pending.splice(0)) {
			answer();
		}
	}
}

describe("ConversationSearch", () => {
	it("asks once typing pauses, for the last words typed", async () => {
		const timer = new FakeTimer();
		const server = new FakeWordsServer({ hang: { c1: { hang: "a hang" } } });
		const search = new ConversationSearch(timer, server);

		search.ask("h");
		search.ask("hang");
		timer.fireTimeouts();
		server.answerAll();
		await Promise.resolve();

		expect(server.asked).toEqual(["hang"]);
		expect(search.said).toEqual({ c1: { hang: "a hang" } });
	});

	it("drops an answer overtaken by more typing", async () => {
		const timer = new FakeTimer();
		const server = new FakeWordsServer({ old: { c1: { old: "old" } } });
		const search = new ConversationSearch(timer, server);

		search.ask("old");
		timer.fireTimeouts();
		search.ask("");
		server.answerAll();
		await Promise.resolve();

		expect(search.said).toEqual({});
	});
});
