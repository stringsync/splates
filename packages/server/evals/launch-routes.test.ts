import { beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EvalLaunches, EvalLaunchSpec } from "./launch";
import { EvalLaunchRoutes } from "./launch-routes";

const launch = (sent: Record<string, unknown>) =>
	new Request("http://localhost/api/evals/launch", {
		method: "POST",
		body: JSON.stringify(sent),
	});

describe("EvalLaunchRoutes", () => {
	let started: EvalLaunchSpec[];
	let launches: EvalLaunches;
	let routes: EvalLaunchRoutes;
	let cwds: Map<string, string>;

	beforeEach(() => {
		cwds = new Map();
		started = [];
		launches = {
			async start(spec: EvalLaunchSpec) {
				started.push(spec);
				return spec;
			},
		} as unknown as EvalLaunches;
		routes = new EvalLaunchRoutes(launches, {
			cwdOf: async (id) => cwds.get(id) ?? null,
		});
	});

	it("starts the run its card names from the one body the Run button sends", async () => {
		const sent = {
			skill: "splates",
			probes: ["resources/install"],
			agents: [{ agent: "claude" }],
			baseline: "fd9f3785",
			key: "card-1",
		};

		const response = await routes.start(launch(sent));

		expect(response.status).toBe(200);
		expect(started).toEqual([{ ...sent, conversation: null, skillDir: null }]);
	});

	it("passes on the conversation whose card it is, to tell it when the run is done", async () => {
		await routes.start(
			launch({
				skill: "splates",
				probes: ["resources/install"],
				agents: [{ agent: "claude" }],
				key: "card-1",
				conversation: "c-1",
			}),
		);

		expect(started[0]?.conversation).toBe("c-1");
	});

	it("runs the skill the conversation works on, when its directory has one", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "eval-routes-test-"));
		await mkdir(join(cwd, "skills/splates"), { recursive: true });
		await writeFile(join(cwd, "skills/splates/SKILL.md"), "# splates\n");
		cwds.set("c-1", cwd);
		const ask = {
			skill: "splates",
			probes: ["resources/install"],
			agents: [{ agent: "claude" }],
			key: "card-1",
		};

		await routes.start(launch({ ...ask, conversation: "c-1" }));
		await routes.start(launch({ ...ask, conversation: "c-2" }));
		await rm(cwd, { recursive: true, force: true });

		expect(started.map((each) => each.skillDir)).toEqual([
			join(cwd, "skills/splates"),
			null,
		]);
	});
});
