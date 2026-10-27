import { describe, expect, it } from "bun:test";
import { agents } from "../agents";
import { FsStorage } from "../storage";
import { MemoryStorage } from "../storage/testing";
import { Testing } from "../testing";
import {
	DEFAULT_AGENTS,
	pickAgent,
	Roster,
	type RosterAgent,
	traitsOf,
} from "./roster";

async function setup() {
	const deps = await Testing.open({ init: false });
	const roster = Roster.in(new FsStorage(deps.splatesHome, deps.fs));
	return Object.assign(deps, { roster });
}

describe("Roster", () => {
	it("adopts a default model an agent offers that an older roster lacks, once", async () => {
		const storage = new MemoryStorage();
		const roster = Roster.in(storage);
		const codex = DEFAULT_AGENTS[1] as RosterAgent;
		const old = {
			...codex,
			models: codex.models.filter((each) => each.id !== "gpt-6.1-sol"),
		};
		await storage.document("agents.json").write({ agents: [old] });
		const offered = {
			codex: [
				{
					id: "model",
					name: "Model",
					category: "model",
					current: "gpt-6.1-sol",
					options: [{ value: "gpt-6.1-sol", name: "6.1 Sol" }],
				},
			],
		} as never;
		expect(await roster.adopt({})).toBe(false);
		expect(await roster.adopt(offered)).toBe(true);
		expect((await roster.agents())[0]?.models.map((each) => each.id)).toContain(
			"gpt-6.1-sol",
		);
		// Dropped by choosing, it stays dropped.
		await roster.choose("codex", ["gpt-6-astra"]);
		expect(await roster.adopt(offered)).toBe(false);
	});

	it("gains Kimi on a roster written before it, once", async () => {
		const storage = new MemoryStorage();
		const roster = Roster.in(storage);
		expect(await roster.gain("kimi")).toBe(false);
		await storage
			.document("agents.json")
			.write({ agents: DEFAULT_AGENTS.slice(0, 2) });
		expect(await roster.gain("kimi")).toBe(true);
		expect((await roster.agents()).map((each) => each.id)).toEqual([
			"claude",
			"codex",
			"kimi",
		]);
		// Taken off, it stays off.
		await roster.remove("kimi");
		expect(await roster.gain("kimi")).toBe(false);
		expect((await roster.agents()).map((each) => each.id)).not.toContain(
			"kimi",
		);
		// A roster seeded with it has seen it, so it never comes back either.
		const seeded = Roster.in(new MemoryStorage());
		await seeded.seed();
		await seeded.remove("kimi");
		expect(await seeded.gain("kimi")).toBe(false);
	});

	it("serializes document edits and retains unrecognized fields", async () => {
		const storage = new MemoryStorage();
		const roster = Roster.in(storage);
		await storage.document("agents.json").write({ agents: [], extra: "keep" });
		await Promise.all([
			roster.update(async (file) => ({
				...file,
				agents: [...(file?.agents ?? []), DEFAULT_AGENTS[0] as RosterAgent],
			})),
			roster.update(async (file) => ({
				...file,
				agents: [...(file?.agents ?? []), DEFAULT_AGENTS[1] as RosterAgent],
			})),
		]);
		expect(await roster.read()).toEqual({
			agents: DEFAULT_AGENTS.slice(0, 2),
			extra: "keep",
		});
	});

	it("refuses to edit a malformed or newer document", async () => {
		const storage = new MemoryStorage();
		const doc = storage.document("agents.json");
		const roster = Roster.in(storage);
		const edit = () => ({ agents: [] });
		await doc.write({ agents: "broken" });
		await expect(roster.update(edit)).toBail("usage");
		expect(await doc.read()).toEqual({ agents: "broken" });
		await doc.write({ format: 999, agents: [] });
		await expect(roster.update(edit)).toBail("outdated");
		expect(await doc.read()).toEqual({ format: 999, agents: [] });
	});

	it("chooses models for one agent, keeping the others, its launch arguments and models of its own", async () => {
		await using deps = await setup();
		await deps.fs.mkdir(deps.splatesHome, { recursive: true });
		await deps.fs.write(
			deps.roster.path,
			JSON.stringify({
				agents: [
					{
						id: "claude",
						name: "Claude",
						argv: ["custom-claude"],
						models: [{ id: "mine", name: "Mine", strengths: "", cost: "" }],
					},
					{ id: "x", name: "X", argv: ["x"], models: [] },
				],
			}),
		);

		await deps.roster.choose("claude", ["sonnet", "opus"]);

		const agents = await deps.roster.agents();
		expect(agents.map((agent) => agent.id)).toEqual(["claude", "x"]);
		expect(agents[0]?.argv).toEqual(["custom-claude"]);
		expect(agents[0]?.models.map((model) => model.id)).toEqual([
			"opus",
			"sonnet",
			"mine",
		]);
	});

	it("ranks a model from an older roster by the defaults' traits", async () => {
		await using deps = await setup();
		const old = [
			{
				id: "claude",
				name: "Claude",
				argv: ["x"],
				models: [{ id: "haiku", name: "H", strengths: "", cost: "low" }],
			},
		];
		await deps.roster.seed();
		await deps.fs.write(
			deps.roster.path,
			JSON.stringify({ format: 1, agents: old }),
		);
		const agents = await deps.roster.agents();

		expect(traitsOf(agents, { agent: "claude", model: "haiku" })).toEqual({
			tier: 1,
			speed: "fast",
			costRank: 1,
		});
		expect(traitsOf(agents, { agent: "claude" })).toBeUndefined();
	});

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

	it("removes one agent, keeping the others, and leaves a roster without it alone", async () => {
		await using deps = await setup();
		await deps.roster.seed();

		await deps.roster.remove("claude");
		const left = await deps.fs.read(deps.roster.path);
		await deps.roster.remove("claude");

		expect((await deps.roster.agents()).map((agent) => agent.id)).toEqual([
			"codex",
			"kimi",
		]);
		expect(await deps.fs.read(deps.roster.path)).toBe(left);
		await deps.roster.remove("codex");
		await deps.roster.remove("kimi");
		expect(await deps.roster.agents()).toEqual([]);
	});

	it("removes nothing while there is no roster", async () => {
		await using deps = await setup();

		await deps.roster.remove("claude");

		expect(await deps.fs.exists(deps.roster.path)).toBe(false);
	});

	it("keeps an optional OpenCode entry and editable provider-qualified models in roster order", async () => {
		await using deps = await setup();
		await deps.roster.seed();
		const opencode = {
			id: "opencode",
			name: "OpenCode",
			argv: ["opencode", "acp"],
			models: [
				{
					id: "opencode-go/fixture",
					name: "Fixture",
					strengths: "test only",
					cost: "unknown",
				},
			],
		};
		const entries = [
			...DEFAULT_AGENTS.slice(0, 1),
			opencode,
			...DEFAULT_AGENTS.slice(1),
		];
		await deps.fs.write(
			deps.roster.path,
			JSON.stringify({ format: 1, agents: entries }),
		);
		expect(await deps.roster.seed()).toBe(false);
		expect(await deps.roster.agents()).toEqual(entries);
		expect(DEFAULT_AGENTS.map((agent) => agent.id)).toEqual([
			"claude",
			"codex",
			"kimi",
		]);
	});

	it("requires exact provider IDs even when roster display names collide", () => {
		const agents = [
			{
				id: "opencode",
				name: "OpenCode",
				argv: ["opencode", "acp"],
				models: ["opencode-go/shared", "openrouter/shared"].map((id) => ({
					id,
					name: "Shared",
					strengths: "fixture",
					cost: "unknown",
				})),
			},
		];
		expect(pickAgent(agents, "opencode", "opencode-go/shared")).toEqual({
			agent: "opencode",
			model: "opencode-go/shared",
		});
		expect(() => pickAgent(agents, "opencode", "Shared")).toThrow(
			"has no model",
		);
		expect(() => pickAgent(agents, "opencode", "shared")).toThrow(
			"has no model",
		);
		expect(() => pickAgent(agents, "opencode", "OPENCODE-GO/shared")).toThrow(
			"has no model",
		);
		expect(() => pickAgent(agents, "opencode", "opencode-go/missing")).toThrow(
			"has no model",
		);
		expect(pickAgent(DEFAULT_AGENTS, "claude", "OPUS").model).toBe("opus");
	});

	it("reads as the defaults while there is no roster", async () => {
		await using deps = await setup();

		expect(await deps.roster.agents()).toEqual(DEFAULT_AGENTS);
		expect(await deps.fs.exists(deps.roster.path)).toBe(false);
	});

	it("names what is wrong with a roster it cannot use", async () => {
		await using deps = await setup();
		await deps.fs.mkdir(deps.splatesHome);

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

	it("refuses a roster written by a newer splates", async () => {
		await using deps = await setup();
		await deps.fs.mkdir(deps.splatesHome);
		await deps.fs.write(
			deps.roster.path,
			JSON.stringify({ format: 2, agents: [] }),
		);

		await expect(deps.roster.agents()).toBail("outdated", {
			message: [
				"written by a newer splates",
				"bunx @stringsync/splates@latest",
			],
		});
	});

	it("prints each agent's command and models, saying where it wrote the defaults", async () => {
		await using deps = await setup();

		await agents({ ...deps, offered: {} });

		const out = deps.out();
		expect(out).toContain(`wrote the default roster to ${deps.roster.path}`);
		expect(out).toContain(
			"Claude (claude)  bunx @agentclientprotocol/claude-agent-acp",
		);
		expect(out).toMatch(/opus\s+Opus 5\.5\s+medium\s+high\s+complex work/);
		expect(out).toContain("Codex (codex)");
	});

	it("prints the roster as JSON", async () => {
		await using deps = await setup();
		await deps.roster.seed();

		await agents({ ...deps, offered: {} }, { json: true });

		expect(JSON.parse(deps.out())).toEqual(
			DEFAULT_AGENTS.map((agent) => ({ ...agent, efforts: [] })),
		);
	});
});
