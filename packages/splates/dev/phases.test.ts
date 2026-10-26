import { describe, expect, it } from "bun:test";
import { GATE_PHASES } from "@stringsync/splates-server/server";
import { FakeFs, FakePs } from "webappwiz/system/testing";
import { PhaseTimer } from "./phases";

describe("PhaseTimer", () => {
	it("appends each phase to the gate's file, a failing one too", async () => {
		const fs = new FakeFs();
		const timer = new PhaseTimer(gatePs(), fs);

		await timer.time("biome", async () => {});
		await expect(
			timer.time("typecheck", async () => {
				throw new Error("Typechecking failed");
			}),
		).rejects.toThrow("Typechecking failed");

		const lines = (await fs.read("/phases.jsonl")).trim().split("\n");
		expect(lines.map((line) => JSON.parse(line))).toEqual([
			{ phase: "biome", ms: expect.any(Number) },
			{ phase: "typecheck", ms: expect.any(Number) },
		]);
	});

	it("names the phase a phase ran within", async () => {
		const fs = new FakeFs();

		await new PhaseTimer(gatePs(), fs).time("web tests", async () => {}, {
			within: "tests",
		});

		expect(JSON.parse(await fs.read("/phases.jsonl"))).toEqual({
			phase: "web tests",
			ms: expect.any(Number),
			within: "tests",
		});
	});

	it("appends a phase's peak memory to the gate's file", async () => {
		const fs = new FakeFs();

		await new PhaseTimer(gatePs(), fs).peak("server tests", 1280);

		expect(JSON.parse(await fs.read("/phases.jsonl"))).toEqual({
			phase: "server tests",
			peakMb: 1280,
		});
	});

	it("only runs the phase outside a gate", async () => {
		const fs = new FakeFs();
		const timer = new PhaseTimer(new FakePs(), fs);

		expect(await timer.time("biome", async () => "ran")).toBe("ran");
		expect(await fs.exists("/phases.jsonl")).toBe(false);
	});
});

/** A gate's process, naming `/phases.jsonl` for its phases. */
function gatePs(): FakePs {
	const ps = new FakePs();
	ps.setEnv({ [GATE_PHASES]: "/phases.jsonl" });
	return ps;
}
