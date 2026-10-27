import { beforeEach, describe, expect, it } from "bun:test";
import { FakeFs, FakePs } from "webappwiz/system/testing";
import { DEFAULT_AGENTS, Roster } from "../models";
import { MemoryStorage } from "../storage/testing";
import { type OpenCodeMetadata, OpenCodeModels } from "./opencode-models";
import type { OpenCodeRecipe } from "./opencode-recipe";

const selected = {
	model: "opencode-go/Case.Main",
	auxiliary: "opencode-go/Small",
};
describe("OpenCode model setup", () => {
	let fs: FakeFs;
	let opencode: FakeOpenCode;
	let models: OpenCodeModels;
	let signal: AbortController;
	const save = () => models.save(selected, signal.signal);
	beforeEach(() => {
		fs = new FakeFs();
		opencode = new FakeOpenCode(
			`${selected.model}\n${selected.auxiliary}\nopencode/Other\n`,
		);
		models = new OpenCodeModels(
			{ fs, ps: new FakePs(), home: "/splates" },
			opencode,
		);
		signal = new AbortController();
	});
	it("reads the persisted recipe after memory expires and checks the actual conversation cwd", async () => {
		await save();
		models.invalidate();
		const calls = opencode.calls.length;
		const recipe = (await models.recipes.stored()) as OpenCodeRecipe;
		expect(recipe).toMatchObject(selected);
		expect(opencode.calls).toHaveLength(calls);
		await models.verifyStored(recipe, "/project/conversation", signal.signal);
		expect(
			opencode.calls
				.slice(calls)
				.filter((args) => args[0] === "api")
				.every((args) => args.includes("directory=/project/conversation")),
		).toBe(true);
		expect(opencode.directories.slice(calls)).toEqual(
			Array(2).fill("/project/conversation"),
		);
	});
	it("refuses missing models and changed rosters on recheck", async () => {
		await save();
		const recipe = (await models.recipes.stored()) as OpenCodeRecipe;
		opencode.catalog = `${selected.auxiliary}\n`;
		await expect(
			models.verifyStored(recipe, "/project", signal.signal),
		).rejects.toThrow("no longer listed");
		opencode.catalog = `${selected.model}\n${selected.auxiliary}\n`;
		await fs.write(
			"/splates/agents.json",
			JSON.stringify({ ...JSON.parse(recipe.raw), extra: "changed" }),
		);
		await expect(
			models.verifyStored(recipe, "/project", signal.signal),
		).rejects.toThrow("roster changed");
	});
	it("disables only the wizard entry and preserves the roster on a failed rename", async () => {
		await save();
		const before = await fs.read("/splates/agents.json");
		const rename = fs.rename.bind(fs);
		fs.rename = async () => {
			throw new Error("disk full");
		};
		await expect(models.recipes.disable(signal.signal)).rejects.toThrow();
		expect(await fs.read("/splates/agents.json")).toBe(before);
		fs.rename = rename;
		await models.recipes.disable(signal.signal);
		expect(JSON.parse(await fs.read("/splates/agents.json")).agents).toEqual(
			DEFAULT_AGENTS,
		);
		expect(await models.recipes.stored()).toBeNull();
	});

	it("saves, checks and disables a recipe on storage without files", async () => {
		const storage = new MemoryStorage();
		models = new OpenCodeModels(
			{ fs, ps: new FakePs(), home: "/unused", roster: Roster.in(storage) },
			opencode,
		);
		await Promise.all([save(), save()]);
		const recipe = (await models.recipes.stored()) as OpenCodeRecipe;
		expect(recipe).toMatchObject(selected);
		await models.verifyStored(recipe, "/project", signal.signal);
		expect(await fs.exists("/unused/agents.json")).toBe(false);
		await models.recipes.disable(signal.signal);
		expect(await models.recipes.stored()).toBeNull();
		expect(await Roster.in(storage).agents()).toEqual(DEFAULT_AGENTS);
	});

	it("preserves another roster edit made while model verification runs", async () => {
		const run = opencode.run.bind(opencode);
		opencode.run = async (...args) => {
			const result = await run(...args);
			await fs.write(
				"/splates/agents.json",
				JSON.stringify({ format: 1, extra: "keep", agents: DEFAULT_AGENTS }),
			);
			return result;
		};
		await save();
		expect(JSON.parse(await fs.read("/splates/agents.json")).extra).toBe(
			"keep",
		);
	});

	it("leaves a custom command alone when disabling setup", async () => {
		const original = JSON.stringify({
			agents: [
				{ id: "opencode", name: "Custom", argv: ["wrapper"], models: [] },
			],
		});
		await fs.write("/splates/agents.json", original);
		await expect(models.recipes.disable(signal.signal)).rejects.toThrow(
			"custom commands",
		);
		expect(await fs.read("/splates/agents.json")).toBe(original);
	});

	it("lists exact Go IDs once for repeated reads, without prompts", async () => {
		expect(opencode.calls).toEqual([]);
		expect(await models.catalog()).toEqual([
			selected.model,
			selected.auxiliary,
		]);
		await models.catalog();
		expect(opencode.calls).toEqual([["models", "--standalone"]]);
	});
	it("lists again after a failed listing", async () => {
		opencode.fail = true;
		await expect(models.catalog()).rejects.toThrow();
		opencode.fail = false;
		expect(await models.catalog()).toHaveLength(2);
	});
	it("refuses a malformed catalog", async () => {
		opencode.catalog = "unexpected diagnostic";
		await expect(models.catalog()).rejects.toThrow("unknown catalog");
	});
	it("adds an entry to the default roster, the main model building and the auxiliary titling", async () => {
		await save();
		const roster = JSON.parse(await fs.read("/splates/agents.json"));
		const ours = DEFAULT_AGENTS.length;
		expect(roster.agents.slice(0, ours)).toEqual(DEFAULT_AGENTS);
		const [env, off, content, ...rest] = roster.agents[ours].argv;
		expect([env, off, ...rest]).toEqual([
			"env",
			"OPENCODE_CONFIG_PROJECT_DISABLE=1",
			"opencode",
			"acp",
		]);
		expect(
			JSON.parse(content.slice("OPENCODE_CONFIG_CONTENT=".length)),
		).toMatchObject({
			model: selected.model,
			warming: false,
			agents: {
				build: { model: selected.model },
				plan: { model: selected.model },
				title: { model: selected.auxiliary },
			},
		});
		expect((await fs.readdir("/splates")).sort()).toEqual(["agents.json"]);
	});
	it("preserves custom fields, model descriptions and order across repeated setup", async () => {
		const original = {
			format: 1,
			extra: "keep",
			agents: [
				{
					id: "custom",
					name: "Custom",
					argv: ["custom"],
					models: [],
					extra: 1,
				},
				{
					id: "opencode",
					name: "My OpenCode",
					argv: ["opencode", "acp"],
					extra: true,
					models: [
						{
							id: selected.model,
							name: "Keep label",
							strengths: "Keep",
							cost: "Keep",
							extra: 7,
						},
					],
				},
			],
		};
		await fs.write("/splates/agents.json", JSON.stringify(original));
		await save();
		const first = await fs.read("/splates/agents.json");
		await save();
		expect(await fs.read("/splates/agents.json")).toBe(first);
		const roster = JSON.parse(first);
		expect(roster.extra).toBe("keep");
		expect(roster.agents[0]).toEqual(original.agents[0]);
		expect(roster.agents[1].models[0]).toEqual(original.agents[1]?.models[0]);
		expect(roster.agents[1].extra).toBe(true);
		expect(roster.agents[1].models).toHaveLength(2);
	});
	it("refuses a model no longer listed", async () => {
		opencode.catalog = `${selected.auxiliary}\n`;
		await expect(save()).rejects.toThrow("no longer listed");
		expect(await fs.exists("/splates/agents.json")).toBe(false);
	});
	it("refuses model overrides and custom Go provider configuration", async () => {
		opencode.conflict = true;
		await expect(save()).rejects.toThrow("override this setup");
		opencode.conflict = false;
		opencode.providerConflict = true;
		await expect(save()).rejects.toThrow("override this setup");
		expect(await fs.exists("/splates/agents.json")).toBe(false);
	});
	it("leaves custom commands untouched", async () => {
		const original = JSON.stringify({
			agents: [
				{
					id: "opencode",
					name: "Custom",
					argv: ["custom-wrapper", "acp"],
					models: [],
				},
			],
		});
		await fs.write("/splates/agents.json", original);
		await expect(save()).rejects.toThrow("launch command");
		expect(await fs.read("/splates/agents.json")).toBe(original);
	});
	it("requires exact case", async () => {
		await expect(
			models.save(
				{ ...selected, model: selected.model.toLowerCase() },
				signal.signal,
			),
		).rejects.toThrow("no longer listed");
	});
	it("cancels before commit and leaves the roster intact after write failure", async () => {
		signal.abort();
		await expect(save()).rejects.toThrow();
		expect(await fs.exists("/splates/agents.json")).toBe(false);
		signal = new AbortController();
		fs.rename = async () => {
			throw new Error("disk full");
		};
		await expect(save()).rejects.toThrow("disk full");
		expect(await fs.exists("/splates/agents.json")).toBe(false);
		expect(await fs.readdir("/splates")).toEqual([]);
	});
});

/** OpenCode 2's metadata commands, answering as it does, with no account. */
class FakeOpenCode implements OpenCodeMetadata {
	/** Whether the effective config gives the models to another provider. */
	conflict = false;
	/** Whether another source configures a Go provider of its own. */
	providerConflict = false;
	/** Whether every command fails, as when OpenCode is offline. */
	fail = false;
	calls: string[][] = [];
	directories: Array<string | undefined> = [];

	/** `catalog` is what `opencode models` lists, a line per model. */
	constructor(public catalog: string) {}

	async run(
		args: string[],
		signal: AbortSignal,
		env?: Record<string, string>,
		cwd?: string,
	): Promise<string> {
		this.directories.push(cwd);
		signal.throwIfAborted();
		this.calls.push(args);
		if (this.fail) {
			throw new Error("private provider diagnostic");
		}
		if (args[0] === "models") {
			return env ? this.catalog.replace("opencode/Other\n", "") : this.catalog;
		}
		if (args[1] === "config.get") {
			return JSON.stringify([
				{
					type: "document",
					info: {
						providers: this.providerConflict
							? { "opencode-go": { secret: "never display" } }
							: { unrelated: { secret: "never display" } },
					},
				},
				{ type: "document", info: this.echo(env) },
			]);
		}
		throw new Error("unexpected command");
	}

	/** The inline config as OpenCode 2 echoes it, models split by provider. */
	private echo(env?: Record<string, string>): Record<string, unknown> {
		const config = JSON.parse(env?.OPENCODE_CONFIG_CONTENT ?? "{}");
		const split = (id: string) => {
			const [providerID, ...model] = id.split("/");
			return {
				providerID: this.conflict ? "opencode" : providerID,
				model: model.join("/"),
			};
		};
		return {
			...config,
			...(config.model ? { model: split(config.model) } : {}),
			...(config.agents
				? {
						agents: Object.fromEntries(
							Object.entries(
								config.agents as Record<string, { model: string }>,
							).map(([name, agent]) => [name, { model: split(agent.model) }]),
						),
					}
				: {}),
		};
	}
}
