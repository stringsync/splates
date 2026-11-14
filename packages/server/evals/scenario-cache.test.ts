import { describe, expect, it } from "bun:test";
import type { Ps } from "core/system";
import { ScenarioCache } from "./scenario-cache";

function psAt(head: () => string): Ps {
	return {
		spawnCapture: async (cmd: string[]) => ({
			exitCode: 0,
			stdout: cmd[1] === "rev-parse" ? head() : "",
			stderr: "",
		}),
	} as unknown as Ps;
}

describe("ScenarioCache", () => {
	it("lists once for cards asking together, and again when HEAD moves", async () => {
		let head = "a";
		const cache = new ScenarioCache(psAt(() => head));
		let listed = 0;
		const list = async () => {
			listed++;
			return [{ id: "x", group: null, about: null }];
		};
		await Promise.all([
			cache.of("/w", "list", list),
			cache.of("/w", "list", list),
		]);
		await cache.of("/w", "list", list);
		expect(listed).toBe(1);
		head = "b";
		await cache.of("/w", "list", list);
		expect(listed).toBe(2);
	});

	it("does not keep a failed listing", async () => {
		const cache = new ScenarioCache(psAt(() => "a"));
		const failed = cache
			.of("/w", "list", async () => {
				throw new Error("no");
			})
			.catch((error: Error) => error.message);
		expect(await failed).toBe("no");
		expect(await cache.of("/w", "list", async () => [])).toEqual([]);
	});
});
