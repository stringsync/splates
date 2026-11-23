import { describe, expect, it } from "bun:test";
import type { Group, RigsPage, RunView } from "@splates/server/rigs/browser";
import { RigsFlow } from "./rigs-flow";

describe("RigsFlow", () => {
	it("names the trees a rig runs on, leaving out exited runs", async () => {
		const flow = new RigsFlow({
			rigsPage: async () => page([run("main"), run("beam-fix", "exited")]),
			stopRun: async () => {},
		});
		await flow.refresh();
		expect(flow.busy("fixture", "echo")).toEqual(["main"]);
	});

	it("dismisses an exited run and opens its start form on its tree", async () => {
		const stopped: string[] = [];
		let runs = [run("beam-fix", "exited")];
		const flow = new RigsFlow({
			rigsPage: async () => page(runs),
			stopRun: async (id) => {
				stopped.push(id);
				runs = [];
			},
		});
		await flow.refresh();
		flow.open("fixture/echo@beam-fix");
		await flow.again(flow.opened() as RunView);
		expect(stopped).toEqual(["fixture/echo@beam-fix"]);
		expect(flow.state.open).toBeNull();
		expect(flow.state.starting?.tree).toBe("beam-fix");
	});

	it("keeps the last listing and says why a read failed", async () => {
		const answers = [
			Promise.resolve(page([])),
			Promise.reject(new Error("offline")),
		];
		const flow = new RigsFlow({
			rigsPage: () => answers.shift() as Promise<RigsPage>,
			stopRun: async () => {},
		});
		await flow.refresh();
		await flow.refresh();
		expect(flow.state.listing?.groups).toHaveLength(1);
		expect(flow.state.failed).toBe("offline");
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
const group: Group = {
	command: "bin/fixture rig",
	name: "fixture",
	rigs: [echo],
};

function run(tree: string, state: RunView["state"] = "healthy"): RunView {
	return {
		id: `fixture/echo@${tree}`,
		group: "fixture",
		rig: "echo",
		label: "Echo server",
		tree,
		exposure: "tunnel",
		slot: null,
		values: { loud: false, mode: "a" },
		preset: null,
		state,
		health: null,
		exitCode: state === "exited" ? 1 : null,
		startedAt: 0,
		endedAt: null,
		ports: [],
		lastLine: null,
	};
}

function page(runs: RunView[]): RigsPage {
	return {
		groups: [group],
		errors: [],
		runs,
		trees: ["main", "beam-fix"],
		presets: {},
	};
}
