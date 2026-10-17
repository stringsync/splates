import { beforeEach, describe, expect, it } from "bun:test";
import { FakeFs, FakePs } from "webappwiz/system/testing";
import { DEFAULT_AGENTS } from "./roster";
import { OpenCodeModels } from "./setup-opencode-models";

const selected = {
	model: "opencode-go/Case.Main",
	auxiliary: "opencode-go/Small",
};
describe("OpenCode model setup", () => {
	let fixture: ModelFixture;
	beforeEach(() => {
		fixture = new ModelFixture();
	});
	it("discovers exact Go IDs without prompts or hard-coded models", async () => {
		expect(fixture.calls).toEqual([]);
		const state = await fixture.models.refresh(fixture.signal.signal);
		expect(state.catalog.models).toEqual([selected.model, selected.auxiliary]);
		expect(fixture.calls).toEqual([
			["models", "--help"],
			["models", "--standalone"],
		]);
	});
	it("clears failed discovery and never displays provider output", async () => {
		await fixture.preview();
		fixture.fail = true;
		const state = await fixture.models.refresh(fixture.signal.signal);
		expect(state.catalog.models).toEqual([]);
		expect(state.preview).toBeNull();
		expect(JSON.stringify(state)).not.toContain("private");
	});
	it("previews without writing and atomically adds an optional entry, preserving defaults", async () => {
		const preview = await fixture.preview();
		expect(await fixture.fs.exists("/arbor/agents.json")).toBe(false);
		expect(preview.config).toMatchObject({
			model: selected.model,
			warming: false,
			agents: {
				title: { model: selected.auxiliary },
				custom: { model: selected.auxiliary },
			},
		});
		expect(JSON.stringify(preview)).not.toContain("never display");
		await fixture.models.apply(preview.token, true, fixture.signal.signal);
		const roster = JSON.parse(await fixture.fs.read("/arbor/agents.json"));
		expect(roster.agents.slice(0, 2)).toEqual(DEFAULT_AGENTS);
		expect(roster.agents[2].argv).toEqual([
			"env",
			"OPENCODE_CONFIG_PROJECT_DISABLE=1",
			`OPENCODE_CONFIG_CONTENT=${JSON.stringify(preview.config)}`,
			"opencode",
			"acp",
		]);
		expect((await fixture.fs.readdir("/arbor")).sort()).toEqual([
			"agents.json",
		]);
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
		await fixture.fs.write("/arbor/agents.json", JSON.stringify(original));
		await fixture.apply();
		const first = await fixture.fs.read("/arbor/agents.json");
		await fixture.apply();
		expect(await fixture.fs.read("/arbor/agents.json")).toBe(first);
		const roster = JSON.parse(first);
		expect(roster.extra).toBe("keep");
		expect(roster.agents[0]).toEqual(original.agents[0]);
		expect(roster.agents[1].models[0]).toEqual(original.agents[1]?.models[0]);
		expect(roster.agents[1].extra).toBe(true);
		expect(roster.agents[1].models).toHaveLength(2);
	});
	it("rejects catalog changes at apply and requires a new preview", async () => {
		const preview = await fixture.preview();
		fixture.catalog = `${selected.auxiliary}\n`;
		await expect(
			fixture.models.apply(preview.token, true, fixture.signal.signal),
		).rejects.toThrow("no longer available");
		expect(await fixture.fs.exists("/arbor/agents.json")).toBe(false);
		expect(fixture.models.read().preview).toBeNull();
	});
	it("rejects a concurrent roster edit without overwriting it", async () => {
		const preview = await fixture.preview();
		await fixture.fs.write("/arbor/agents.json", "concurrent edit");
		await expect(
			fixture.models.apply(preview.token, true, fixture.signal.signal),
		).rejects.toThrow("roster changed");
		expect(await fixture.fs.read("/arbor/agents.json")).toBe("concurrent edit");
	});
	it("refuses model overrides and custom Go provider configuration", async () => {
		fixture.conflict = true;
		await expect(fixture.preview()).rejects.toThrow("overrides");
		fixture.conflict = false;
		fixture.providerConflict = true;
		await expect(fixture.preview()).rejects.toThrow("conflicts");
		expect(await fixture.fs.exists("/arbor/agents.json")).toBe(false);
	});
	it("refuses malformed catalogs and canceled previews", async () => {
		fixture.catalog = "unexpected diagnostic";
		expect(
			(await fixture.models.refresh(fixture.signal.signal)).catalog.models,
		).toEqual([]);
		fixture.catalog = `${selected.model}\n${selected.auxiliary}\n`;
		const preview = await fixture.preview();
		fixture.models.cancel();
		await expect(
			fixture.models.apply(preview.token, true, fixture.signal.signal),
		).rejects.toThrow("Preview expired");
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
		await fixture.fs.write("/arbor/agents.json", original);
		await expect(fixture.preview()).rejects.toThrow("custom launch");
		expect(await fixture.fs.read("/arbor/agents.json")).toBe(original);
	});
	it("requires exact case and explicit billing confirmation", async () => {
		await fixture.models.refresh(fixture.signal.signal);
		await expect(
			fixture.models.preview(
				{ ...selected, model: selected.model.toLowerCase() },
				fixture.signal.signal,
			),
		).rejects.toThrow("exact available");
		const preview = await fixture.preview();
		await expect(
			fixture.models.apply(preview.token, false, fixture.signal.signal),
		).rejects.toThrow("Use balance");
		expect(await fixture.fs.exists("/arbor/agents.json")).toBe(false);
	});
	it("cancels before commit and leaves the roster intact after write failure", async () => {
		const preview = await fixture.preview();
		fixture.signal.abort();
		await expect(
			fixture.models.apply(preview.token, true, fixture.signal.signal),
		).rejects.toThrow();
		expect(await fixture.fs.exists("/arbor/agents.json")).toBe(false);
		fixture.signal = new AbortController();
		const retry = await fixture.preview();
		fixture.fs.rename = async () => {
			throw new Error("disk full");
		};
		await expect(
			fixture.models.apply(retry.token, true, fixture.signal.signal),
		).rejects.toThrow("disk full");
		expect(await fixture.fs.exists("/arbor/agents.json")).toBe(false);
		expect(await fixture.fs.readdir("/arbor")).toEqual([]);
	});
});

class ModelFixture {
	fs = new FakeFs();
	ps = new FakePs();
	signal = new AbortController();
	catalog = `${selected.model}\n${selected.auxiliary}\nopencode/Other\n`;
	names = ["build", "plan", "title", "compaction", "custom"];
	conflict = false;
	providerConflict = false;
	fail = false;
	calls: string[][] = [];
	models = new OpenCodeModels(
		{ fs: this.fs, ps: this.ps, home: "/arbor" },
		{
			run: async (args, signal, env) => {
				signal.throwIfAborted();
				this.calls.push(args);
				if (this.fail) {
					throw new Error("private provider diagnostic");
				}
				if (args.includes("--help")) {
					return "--standalone --param";
				}
				if (args[0] === "models") {
					return env
						? this.catalog.replace("opencode/Other\n", "")
						: this.catalog;
				}
				const config = JSON.parse(env?.OPENCODE_CONFIG_CONTENT ?? "{}");
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
						{ type: "document", info: config },
					]);
				}
				if (args[1] === "agent.list") {
					return JSON.stringify({
						data: this.names.map((id) => ({
							id,
							...(config.agents
								? {
										model: {
											providerID: this.conflict ? "opencode" : "opencode-go",
											id: config.agents[id]?.model.slice("opencode-go/".length),
										},
									}
								: {}),
						})),
					});
				}
				throw new Error("unexpected command");
			},
		},
	);
	async preview() {
		await this.models.refresh(this.signal.signal);
		const preview = (await this.models.preview(selected, this.signal.signal))
			.preview;
		if (!preview) {
			throw new Error("Missing preview");
		}
		return preview;
	}
	async apply() {
		const preview = await this.preview();
		return this.models.apply(preview.token, true, this.signal.signal);
	}
}
