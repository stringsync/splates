import { describe, expect, it } from "bun:test";
import { MemoryLogger } from "core/log";
import { Duration } from "core/time";
import type { Served } from "./project";
import type { Stuck } from "./release";
import { Versions } from "./versions";

const COMMIT_A = "a".repeat(40);
const COMMIT_B = "b".repeat(40);

function servedMap(onRefresh: () => void): Map<string, Promise<Served>> {
	return new Map([
		["/repo", Promise.resolve({ refresh: onRefresh } as unknown as Served)],
	]);
}

describe("Versions", () => {
	it("reads an already-stuck checkout on start without marking behind", async () => {
		const stuck: Stuck = {
			upstream: "origin/main",
			local: COMMIT_A,
			newest: COMMIT_B,
			commits: 3,
			root: "/repo",
			dirty: 2,
		};
		const versions = await Versions.start(new Map(), new MemoryLogger(), {
			running: "2.0.11",
			newest: async () => null,
			checkEvery: Duration.mins(60),
			source: async () => COMMIT_A,
			stuck: async () => stuck,
			sourceEvery: Duration.secs(15),
		});
		expect(versions.behind).toBeNull();
		expect(versions.stuck).toEqual(stuck);
	});

	it("refreshes served projects when stuck appears and clears once unstuck", async () => {
		let refreshes = 0;
		let currentSource = COMMIT_A;
		let currentStuck: Stuck | null = null;
		const versions = await Versions.start(
			servedMap(() => {
				refreshes += 1;
			}),
			new MemoryLogger(),
			{
				running: "2.0.11",
				newest: async () => null,
				checkEvery: Duration.mins(60),
				source: async () => currentSource,
				stuck: async () => currentStuck,
				sourceEvery: Duration.ms(20),
			},
		);
		const checks = versions.check();
		try {
			expect(versions.stuck).toBeNull();

			currentStuck = {
				upstream: "origin/main",
				local: COMMIT_A,
				newest: COMMIT_B,
				commits: 5,
				root: "/repo",
				dirty: 1,
			};
			await Bun.sleep(60);
			expect(versions.stuck).toEqual(currentStuck);
			expect(versions.behind).toBeNull();
			expect(refreshes).toBe(1);

			// Unstick and fast-forward local source to COMMIT_B.
			currentStuck = null;
			currentSource = COMMIT_B;
			await Bun.sleep(60);
			expect(versions.stuck).toBeNull();
			expect(versions.behind).toEqual({ running: COMMIT_A, newest: COMMIT_B });
			expect(refreshes).toBe(2);
		} finally {
			checks.dispose();
		}
	});
});
