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

	it("reads the machine's setup and skips a step", async () => {
		const server = await dev(deps, { ports: OpenPortProvider.any() });
		try {
			const fresh = (await (
				await fetch(`http://localhost:${server.port}/api/setup`)
			).json()) as SetupProgress;
			const skipped = await json(
				server.port,
				"/api/setup/dictation/skipped",
				"PUT",
				{ skipped: true },
			);
			const unknown = await json(
				server.port,
				"/api/setup/nope/skipped",
				"PUT",
				{ skipped: true },
			);

			expect(fresh.next).toBe("agent-roster");
			expect(skipped.status).toBe(200);
			expect(
				((await skipped.json()) as SetupProgress).areas.find(
					(area) => area.id === "dictation",
				)?.skipped,
			).toBe(1);
			expect(unknown.status).toBe(404);
		} finally {
			await server.disposeAsync();
		}
	});
});
