import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "core/creds/testing";
import { FakeFs } from "core/system/testing";
import { SHIPS_AREA } from "./area-ships";
import { Setup, type SetupMachine } from "./setup";

describe("SHIPS_AREA", () => {
	let ship: string | null;
	let ships: Record<string, { paths: string[]; ship: string | null }> | null;
	let shipStatus: string | null;
	let machine: SetupMachine;

	beforeEach(() => {
		ship = null;
		ships = null;
		shipStatus = null;
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
					evals: null,
					ship,
					shipStatus,
					ships,
				}),
				remoteUrl: async () => null,
			},
		};
	});

	async function steps() {
		const progress = await new Setup(machine, [SHIPS_AREA]).read();
		return progress.areas[0]?.steps.map((step) => step.status);
	}

	it("starts at naming a ship command", async () => {
		expect(await steps()).toEqual(["ready", "waiting"]);
	});

	it("takes a ship command of the repository", async () => {
		ship = "bin/ship";
		expect(await steps()).toEqual(["done", "ready"]);
	});

	it("takes a target that can ship, not one that never does", async () => {
		ships = { a: { paths: ["a/**"], ship: null } };
		expect((await steps())?.[0]).toBe("ready");
		ships = { a: { paths: ["a/**"], ship: "a/ship" } };
		expect((await steps())?.[0]).toBe("done");
	});

	it("is done with a status command too", async () => {
		ship = "bin/ship";
		shipStatus = "bin/status";
		expect(await steps()).toEqual(["done", "done"]);
	});
});
