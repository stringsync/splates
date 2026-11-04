import { afterEach, describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import type { Sandbox } from "@evals/evals/sandbox";
import { type Scenario, splatesSandbox } from "./box";

const SKILL = resolve(import.meta.dir, "../../../skills/splates");

describe("splatesSandbox", () => {
	let box: Sandbox | null = null;

	afterEach(async () => {
		await box?.remove();
		box = null;
	});

	const scenario: Scenario = {
		id: "test/plain",
		aspect: "test",
		requirement: "r",
		message: "m",
		seed: async (repo) => repo.write("seeded.txt", "seeded\n"),
	};

	it("seeds the repo and gives its commands a private splates home and this checkout's splates", async () => {
		process.env.SPLATES_CONVERSATION = "theirs";
		try {
			box = await splatesSandbox([scenario])(SKILL, scenario);
		} finally {
			delete process.env.SPLATES_CONVERSATION;
		}

		expect(await box.repo.run(["cat", "seeded.txt"])).toBe("seeded\n");
		expect(await box.repo.run(["cat", "splates.config.ts"])).toContain(
			"preMerge",
		);
		expect(box.env.SPLATES_HOME).toContain("splates-home");
		expect(box.env.SPLATES_CONVERSATION).toBeUndefined();
		expect(box.env.PATH?.split(":")[0]).toEndWith("/bin");
		expect(await box.repo.run(["which", "splates"])).toStartWith(
			box.env.PATH?.split(":")[0] ?? "",
		);
	});

	it("runs splates init in an initialized scenario, leaving the repo committed", async () => {
		const initialized = { ...scenario, initialized: true };
		box = await splatesSandbox([initialized])(SKILL, initialized);

		expect(await box.repo.run(["git", "status", "--porcelain"])).toBe("");
	});
});

// These are the aspect modules bin/evals discovers independently.
it.each([
	"budget",
	"continuity",
	"decisions",
	"delivery",
	"discovery",
	"graders",
	"lifecycle",
	"orchestration",
	"proposing",
	"resources",
])("exports an isolated sandbox from the %s aspect", async (aspect) => {
	const module = await import(`${SKILL}/evals/${aspect}.ts`);
	const scenario = module.scenarios[0];
	expect(scenario).toBeDefined();
	const box = await module.sandbox(SKILL, scenario);
	try {
		expect(box.env.SPLATES_HOME).toContain("splates-home");
		expect(
			(await box.repo.run(["git", "log", "--format=%s"]))
				.split("\n")
				.includes("Initialize splates"),
		).toBe(scenario.initialized ?? false);
	} finally {
		await box.remove();
	}
});
