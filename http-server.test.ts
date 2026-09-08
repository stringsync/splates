import { afterEach, describe, expect, it } from "bun:test";
import { Duration } from "webappwiz/time";
import { BunHttpServer, type Listening } from "./http-server";

describe("BunHttpServer", () => {
	let listening: Listening;

	const serve = async (body: string): Promise<string> => {
		listening = await new BunHttpServer().serve(
			() => new Response(body),
			// port 0 so tests never collide with each other or with a real server
			{ port: 0, idleTimeout: Duration.zero() },
		);
		return `http://localhost:${listening.port}`;
	};

	afterEach(() => listening.stop());

	it("answers with what the handler returns", async () => {
		const base = await serve("hello");

		expect(await (await fetch(base)).text()).toBe("hello");
	});

	it("reports the port it actually bound when asked for any", async () => {
		await serve("hello");

		expect(listening.port).toBeGreaterThan(0);
	});

	it("refuses connections once stopped", async () => {
		const base = await serve("hello");

		await listening.stop();

		// awaited: an unawaited rejection here surfaces as an unhandled error in
		// whichever test the runner happens to be in when it lands
		await expect(fetch(base)).rejects.toThrow();
	});
});
