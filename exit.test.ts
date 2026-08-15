import { beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "@webappwiz/log";
import { NodePs } from "@webappwiz/system";
import { FakeProcess } from "@webappwiz/system/testing";
import { EXIT, exits, fail } from "./exit";

describe("exit", () => {
	let process: FakeProcess;
	let log: MemoryLogger;
	let ps: NodePs;
	let middleware: ReturnType<typeof exits>;

	beforeEach(() => {
		process = new FakeProcess();
		log = new MemoryLogger();
		ps = new NodePs({ proc: process });
		middleware = exits();
	});

	it("keeps the exit codes stable", () => {
		// pinned: these codes are arbor's API and an agent branches on them, so a
		// renumbering has to be deliberate, and README.md's table has one source
		expect(EXIT).toEqual({
			usage: 1,
			conflict: 2,
			tests_failed: 3,
			lease_lost: 4,
			budget_exhausted: 5,
			lease_held: 6,
			dirty: 7,
			not_found: 8,
			hook_failed: 9,
			exists: 10,
			orphaned: 11,
			merge_failed: 12,
			already_removed: 13,
		});
	});

	it("turns a refusal into JSON, an explanation and a status code", async () => {
		await middleware({ log, ps }, async () => {
			fail("conflict", "rebase conflicted", { task: "alpha" });
		});

		expect(process.lastExit()).toBe(EXIT.conflict);
		const [json, human] = log.entries;
		expect(JSON.parse(String(json?.message))).toEqual({
			reason: "conflict",
			task: "alpha",
		});
		expect(String(human?.message)).toContain("rebase conflicted");
	});

	it("lets anything that is not a refusal through", async () => {
		const boom = middleware({ log, ps }, async () => {
			throw new Error("boom");
		});

		expect(boom).rejects.toThrow("boom");
		expect(process.lastExit()).toBeUndefined();
	});

	it("leaves a command that succeeded alone", async () => {
		await middleware({ log, ps }, async () => {});

		expect(process.lastExit()).toBeUndefined();
		expect(log.entries).toEqual([]);
	});
});
