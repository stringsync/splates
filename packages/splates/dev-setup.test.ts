import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { OpenPortProvider } from "webappwiz/system";
import { dev } from "./dev";
import { json } from "./dev-testing";
import type { SetupProgress } from "./setup";
import { Testing } from "./testing";

describe("dev's setup routes", () => {
	let deps: Testing;

	beforeEach(async () => {
		deps = await Testing.open();
	});

	afterEach(() => deps.disposeAsync());

	it("reads the machine's setup and presses a step's Next", async () => {
		const server = await dev(deps, { ports: OpenPortProvider.any() });
		try {
			const fresh = (await (
				await fetch(`http://127.0.0.1:${server.port}/api/setup`)
			).json()) as SetupProgress;
			const unsaved = await json(
				server.port,
				"/api/setup/dictation/next",
				"POST",
				{ answers: {} },
			);
			const unknown = await json(server.port, "/api/setup/nope/next", "POST", {
				answers: {},
			});

			expect(fresh.next).toBe("agent-roster");
			expect(unsaved.status).toBe(422);
			expect(await unsaved.json()).toEqual({
				reason: "step",
				message: "Paste the OpenAI API key first.",
			});
			expect(unknown.status).toBe(404);
		} finally {
			await server.disposeAsync();
		}
	});
});
