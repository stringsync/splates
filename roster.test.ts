import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { agents } from "./agents";
import { DEFAULT_AGENTS, Roster } from "./roster";
import { Testing } from "./testing";

async function setup() {
	const deps = await Testing.open({ init: false });
	const roster = new Roster(join(deps.arborHome, "agents.json"), {
		fs: deps.fs,
	});
	return Object.assign(deps, { roster });
}

describe("Roster", () => {
	it("writes the defaults once, leaving an edited roster alone", async () => {
		await using deps = await setup();

		expect(await deps.roster.seed()).toBe(true);
		expect(await deps.roster.agents()).toEqual(DEFAULT_AGENTS);

		const mine = [
			{ id: "gemini", name: "Gemini", argv: ["gemini", "--acp"], models: [] },
		];
		await deps.fs.write(
			deps.roster.path,
			JSON.stringify({ format: 1, agents: mine }),
		);
		expect(await deps.roster.seed()).toBe(false);
		expect(await deps.roster.agents()).toEqual(mine);
	});

	it("reads as the defaults while there is no roster", async () => {
		await using deps = await setup();

		expect(await deps.roster.agents()).toEqual(DEFAULT_AGENTS);
		expect(await deps.fs.exists(deps.roster.path)).toBe(false);
	});

	it("names what is wrong with a roster it cannot use", async () => {
		await using deps = await setup();
		await deps.fs.mkdir(deps.arborHome);

		await deps.fs.write(deps.roster.path, "{");
		await expect(deps.roster.agents()).toBail("usage", {
			message: "is not JSON",
		});

		await deps.fs.write(
			deps.roster.path,
			JSON.stringify({ agents: [{ id: "claude", name: "Claude", argv: [] }] }),
		);
		await expect(deps.roster.agents()).toBail("usage", {
			message: "agents.0.argv",
		});

		const twice = { id: "claude", name: "Claude", argv: ["c"], models: [] };
		await deps.fs.write(
			deps.roster.path,
			JSON.stringify({ agents: [twice, twice] }),
		);
		await expect(deps.roster.agents()).toBail("usage", {
			message: "lists agent 'claude' twice",
		});
	});

	it("refuses a roster written by a newer arbor", async () => {
		await using deps = await setup();
		await deps.fs.mkdir(deps.arborHome);
		await deps.fs.write(
			deps.roster.path,
			JSON.stringify({ format: 2, agents: [] }),
		);

		await expect(deps.roster.agents()).toBail("outdated", {
			message: ["written by a newer arbor", "bunx @webappwiz/arbor@latest"],
		});
	});
});

describe("agents", () => {
	it("prints each agent's command and models, saying where it wrote the defaults", async () => {
		await using deps = await setup();

		await agents(deps);

		const out = deps.out();
		expect(out).toContain(`wrote the default roster to ${deps.roster.path}`);
		expect(out).toContain(
			"Claude (claude)  bunx @agentclientprotocol/claude-agent-acp",
		);
		expect(out).toMatch(/opus\s+Opus 5\.5\s+high\s+complex work/);
		expect(out).toContain("Codex (codex)");
	});

	it("prints the roster as JSON", async () => {
		await using deps = await setup();
		await deps.roster.seed();

		await agents(deps, { json: true });

		expect(JSON.parse(deps.out())).toEqual(DEFAULT_AGENTS);
	});
});
