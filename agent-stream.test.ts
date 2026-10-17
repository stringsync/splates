import { beforeEach, describe, expect, it } from "bun:test";
import type * as acp from "@agentclientprotocol/sdk";
import { HandFedProcess } from "./agent-process-testing";
import { AgentStream } from "./agent-stream";

/** One macrotask later, as the stream waits between messages. */
const later = () => new Promise<void>((resolve) => setImmediate(resolve));

const line = (message: object) => `${JSON.stringify(message)}\n`;
const update = (text: string) =>
	line({ jsonrpc: "2.0", method: "session/update", params: { text } });

describe("AgentStream", () => {
	let process: HandFedProcess;
	let stream: AgentStream;
	let reader: ReadableStreamDefaultReader<acp.AnyMessage>;
	let dispatched: number[];

	beforeEach(() => {
		process = new HandFedProcess();
		stream = new AgentStream(process, { base: 10 });
		reader = stream.readable.getReader();
		// Its own, since a stream's last frame finishes a macrotask after its test.
		const seen: number[] = [];
		dispatched = seen;
		stream.events.on("dispatched", (seq) => seen.push(seq));
	});

	it("names the frame of the message being handled, and hands over the next only after", async () => {
		process.print(update("one"));
		process.print(update("two"));

		const first = await reader.read();
		expect(first.value).toMatchObject({ params: { text: "one" } });
		expect(stream.seq).toBe(1);
		const second = reader.read();
		await Promise.resolve();
		expect(stream.seq).toBe(1);
		expect(dispatched).toEqual([]);
		await later();

		expect((await second).value).toMatchObject({ params: { text: "two" } });
		expect(stream.seq).toBe(2);
		expect(dispatched).toEqual([1]);
		await later();
		expect(dispatched).toEqual([1, 2]);
	});

	it("holds lines until a frame ends on a newline, counting them all to that frame", async () => {
		process.print(`${update("one")}{"jsonrpc":"2.0","method":"ses`);
		process.print(`sion/update","params":{"text":"two"}}\n`);

		const first = await reader.read();
		await later();
		const second = await reader.read();
		await later();

		expect(first.value).toMatchObject({ params: { text: "one" } });
		expect(second.value).toMatchObject({ params: { text: "two" } });
		expect(stream.seq).toBe(2);
		expect(dispatched).toEqual([2]);
	});

	it("offsets the ids of the requests it sends by its base, and takes it off their answers", async () => {
		const requests: { id: number; method: string }[] = [];
		stream.events.on("request", (request) => requests.push(request));
		const writer = stream.writable.getWriter();
		await writer.write({
			jsonrpc: "2.0",
			id: 0,
			method: "session/prompt",
			params: {},
		});
		process.print(line({ jsonrpc: "2.0", id: 10, result: { ok: true } }));

		const answer = await reader.read();

		expect(process.typed).toEqual([
			line({ jsonrpc: "2.0", id: 10, method: "session/prompt", params: {} }),
		]);
		expect(requests).toEqual([{ id: 10, method: "session/prompt" }]);
		expect(stream.lastId).toBe(10);
		expect(answer.value).toEqual({
			jsonrpc: "2.0",
			id: 0,
			result: { ok: true },
		});
	});

	it("hands back an answer to a request from before it, rather than passing it on", async () => {
		const stale: acp.AnyResponse[] = [];
		stream.events.on("stale", (response) => stale.push(response));
		process.print(
			line({ jsonrpc: "2.0", id: 3, result: { stopReason: "end_turn" } }),
		);
		process.print(update("after"));

		const next = await reader.read();
		await later();

		expect(stale).toEqual([
			{ jsonrpc: "2.0", id: 3, result: { stopReason: "end_turn" } },
		]);
		expect(next.value).toMatchObject({ params: { text: "after" } });
		expect(dispatched).toEqual([1, 2]);
	});

	it("answers a request of the agent's raw, as it was on the wire", async () => {
		await stream.respond(7, { result: { outcome: { outcome: "cancelled" } } });

		expect(process.typed).toEqual([
			line({
				jsonrpc: "2.0",
				id: 7,
				result: { outcome: { outcome: "cancelled" } },
			}),
		]);
	});

	it("ends once the process's output does", async () => {
		process.print(update("last"));
		process.end();

		await reader.read();
		const done = await reader.read();

		expect(done.done).toBe(true);
	});
});
