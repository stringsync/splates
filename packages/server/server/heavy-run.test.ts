import { describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { NodeFs, NodePs } from "webappwiz/system";
import { runHeavy } from "./heavy-run";

describe("a command run here", () => {
	it("is killed once it runs past its timeout, exiting 124 and saying why", async () => {
		const log = new MemoryLogger();
		const ctx = { fs: new NodeFs(), ps: new NodePs(), log };

		const code = await runHeavy(ctx, ["sleep", "30"], {
			runner: async () => null,
			timeout: "0.3s",
		});

		expect(code).toBe(124);
		expect(log.entries.map((entry) => entry.message)).toContainEqual(
			expect.stringContaining("killed after running past its 300ms timeout"),
		);
	});

	it("exits as the command does within its timeout", async () => {
		const ctx = { fs: new NodeFs(), ps: new NodePs(), log: new MemoryLogger() };

		expect(
			await runHeavy(ctx, ["sh", "-c", "exit 3"], {
				runner: async () => null,
			}),
		).toBe(3);
	});
});
