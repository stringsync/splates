import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "core/creds/testing";
import { FakeFs } from "core/system/testing";
import { SHIPS_AREA } from "./area-legacy-ships";
import { Setup, type SetupMachine } from "./setup";

describe("SHIPS_AREA", () => {
	let ship: string | null;
	let ships: Record<string, { ship: string }> | null;

	let machine: SetupMachine;

	beforeEach(() => {
		ship = null;
		ships = null;

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
					legacyShips: ships,
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
		expect(await steps()).toEqual(["ready"]);
	});

	it("does not infer a target from the obsolete repository command", async () => {
		ship = "bin/ship";
		expect(await steps()).toEqual(["ready"]);
	});

	it("takes a declared target", async () => {
		ships = { a: { ship: "a/ship" } };
		expect(await steps()).toEqual(["done"]);
	});
});
