import { describe, expect, it } from "bun:test";
import { FakePs } from "webappwiz/system/testing";
import { LegacyNamesPs } from "./legacy-ps";

describe("LegacyNamesPs", () => {
	it("reads a variable under arbor's name when splates's is unset", () => {
		const inner = new FakePs();
		inner.setEnv({ ARBOR_HOME: "/old" });

		expect(new LegacyNamesPs(inner).env("SPLATES_HOME")).toBe("/old");
	});

	it("prefers splates's name when both are set", () => {
		const inner = new FakePs();
		inner.setEnv({ ARBOR_HOME: "/old", SPLATES_HOME: "/new" });

		expect(new LegacyNamesPs(inner).env("SPLATES_HOME")).toBe("/new");
	});

	it("sets each variable on a child under both names", async () => {
		const inner = new FakePs();

		await new LegacyNamesPs(inner).spawn(["wiz"], {
			env: { SPLATES_TASK: "1", OTHER: "x" },
		});

		expect(inner.getCallEnvs()).toEqual([
			{ SPLATES_TASK: "1", OTHER: "x", ARBOR_TASK: "1" },
		]);
	});
});
