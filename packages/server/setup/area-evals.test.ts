import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { FakeFs } from "webappwiz/system/testing";
import { EVALS_AREA } from "./area-evals";
import { Setup, type SetupMachine } from "./setup";

describe("EVALS_AREA", () => {
	let evals: { results: string } | null;
	let machine: SetupMachine;

	beforeEach(() => {
		evals = null;
		machine = {
			fs: new FakeFs(),
			home: "/home/.splates",
			device: new FakeSecretStore(),
			project: {
				root: "/repo",
				config: async () => ({
					trunk: "main",
					remote: null,
					replica: null,
					evals,
				}),
				remoteUrl: async () => null,
			},
		};
	});

	async function step() {
		const progress = await new Setup(machine, [EVALS_AREA]).read();
		return progress.areas[0]?.steps[0];
	}

	it("points at the docs until the config names evals.results", async () => {
		expect((await step())?.status).toBe("ready");
		expect((await step())?.user).toContain("docs/evals.md");
	});

	it("is done once it does, saying where the results are read", async () => {
		evals = { results: ".evals" };
		const done = await step();
		expect(done?.status).toBe("done");
		expect(done?.detail).toContain(".evals");
	});
});
