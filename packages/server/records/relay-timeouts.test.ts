import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Duration } from "webappwiz/time";
import { FaultProxy } from "../workers/testing";
import { RelayApp } from "./relay-app";
import { RelayLanding } from "./relay-landing";

const REQUEST = {
	task: "fix",
	onto: "a".repeat(40),
	head: "b".repeat(40),
	holder: { pid: 1, hostname: "box" },
};

describe("a worker's relay to a coordinator that stops answering", () => {
	let server: Bun.Server<undefined>;
	let proxy: FaultProxy;
	let url: string;

	beforeEach(() => {
		server = Bun.serve({
			port: 0,
			hostname: "127.0.0.1",
			fetch: (request) =>
				Response.json(
					new URL(request.url).pathname === "/api/token"
						? { value: { token: "t", expiresAt: "2999-01-01T00:00:00Z" } }
						: { value: { status: "landed", local: "moved" } },
				),
		});
		proxy = FaultProxy.listen(server.port as number);
		url = `http://127.0.0.1:${proxy.port}`;
	});

	afterEach(async () => {
		proxy.dispose();
		await server.stop(true);
	});

	it("lands through the relay while it answers", async () => {
		const landing = new RelayLanding(url, { slug: "p" });

		expect(await landing.land(REQUEST)).toEqual({
			status: "landed",
			local: "moved",
		});
	});

	it("refuses a landing left unanswered, rather than holding the lease", async () => {
		proxy.stall();
		const landing = new RelayLanding(
			url,
			{ slug: "p" },
			{ within: Duration.ms(300) },
		);

		const landed = await landing.land(REQUEST);

		expect(landed.status).toBe("refused");
		expect(landed.status === "refused" && landed.why).toContain(
			"did not answer the landing within 0.3s",
		);
	});

	it("gives up on a token left unminted", async () => {
		proxy.stall();
		const app = new RelayApp(url, { slug: "p" }, { within: Duration.ms(300) });

		await expect(app.app()).rejects.toThrow(
			"the coordinator minted no token within 0.3s",
		);
	});
});
