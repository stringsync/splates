import { describe, expect, it } from "bun:test";
import type { RunView } from "@splates/server/rigs/browser";
import { RigStartForm } from "./rig-start-form";

describe("RigStartForm", () => {
	it("fills a preset over the defaults, and starts with the values and preset", async () => {
		const sent: unknown[] = [];
		const form = new RigStartForm(
			{
				startRun: async (request) => {
					sent.push(request);
					return run(request.tree);
				},
				savePreset: async () => ({}),
			},
			"fixture",
			echo,
			"main",
		);
		form.pick("Loud", { Loud: { loud: true } });
		expect(form.state.values).toEqual({ loud: true, mode: "a" });
		form.tree("beam-fix");
		expect(await form.start()).toBe("fixture/echo@beam-fix");
		expect(sent).toEqual([
			{
				group: "fixture",
				rig: "echo",
				tree: "beam-fix",
				values: { loud: true, mode: "a" },
				preset: "Loud",
			},
		]);
	});

	it("forgets the preset once a value changes, and shows why a start was refused", async () => {
		const form = new RigStartForm(
			{
				startRun: async () => {
					throw new Error("Echo server already runs on main");
				},
				savePreset: async () => ({}),
			},
			"fixture",
			echo,
			"main",
		);
		form.pick("Loud", { Loud: { loud: true } });
		form.set("mode", "b");
		expect(form.state.preset).toBeNull();
		expect(await form.start()).toBeNull();
		expect(form.state.refused).toBe("Echo server already runs on main");
	});

	it("saves the values under the name typed", async () => {
		const saved: unknown[] = [];
		const form = new RigStartForm(
			{
				startRun: async (request) => run(request.tree),
				savePreset: async (preset) => {
					saved.push(preset);
					return { "fixture/echo": { Mine: { loud: false, mode: "a" } } };
				},
			},
			"fixture",
			echo,
			"main",
		);
		form.naming("  Mine ");
		await form.save();
		expect(saved).toEqual([
			{
				group: "fixture",
				rig: "echo",
				name: "Mine",
				values: { loud: false, mode: "a" },
			},
		]);
		expect(form.state.preset).toBe("Mine");
		expect(form.state.naming).toBeNull();
	});
});

const echo = {
	name: "echo",
	label: "Echo server",
	ports: ["web"],
	exposure: "tunnel" as const,
	options: [
		{ name: "loud", type: "boolean" as const, default: false },
		{
			name: "mode",
			type: "enum" as const,
			values: ["a", "b"],
			default: "a",
		},
	],
};

function run(tree: string): RunView {
	return {
		id: `fixture/echo@${tree}`,
		group: "fixture",
		rig: "echo",
		label: "Echo server",
		tree,
		exposure: "tunnel",
		slot: null,
		values: {},
		preset: null,
		state: "starting",
		health: null,
		exitCode: null,
		startedAt: 0,
		endedAt: null,
		ports: [],
		lastLine: null,
	};
}
