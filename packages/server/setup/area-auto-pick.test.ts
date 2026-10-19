import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { FakeFs } from "webappwiz/system/testing";
import { DEFAULT_RULES } from "../auto-pick";
import { AUTO_PICK_AREA } from "./area-auto-pick";
import { Setup, type SetupMachine, type StepStatus } from "./setup";

const HOME = "/home/.splates";

describe("AUTO_PICK_AREA", () => {
	let machine: SetupMachine;
	let setup: Setup;
	const statuses = async (): Promise<Record<string, StepStatus>> =>
		Object.fromEntries(
			((await setup.read()).areas[0]?.steps ?? []).map((step) => [
				step.id,
				step.status,
			]),
		);

	beforeEach(async () => {
		machine = { fs: new FakeFs(), home: HOME, device: new FakeSecretStore() };
		await machine.fs.mkdir(HOME, { recursive: true });
		setup = new Setup(machine, [AUTO_PICK_AREA]);
	});

	it("leaves each step on a fresh machine, the try waiting on the rules", async () => {
		expect(await statuses()).toEqual({
			"auto-pick-judge": "ready",
			"auto-pick-rules": "ready",
			"auto-pick-try": "waiting",
		});
	});

	it("takes Next on the judge without a key pasted, but is done only once a judge's creds are kept", async () => {
		await expect(setup.submit("auto-pick-judge", {})).rejects.toThrow(
			"Paste a TypeSafe API key, or keep CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN for this device, then press Next.",
		);
		await machine.device.set("TYPESAFE_API_KEY", "key");

		await setup.submit("auto-pick-judge", {});
		expect((await statuses())["auto-pick-judge"]).toBe("done");
	});

	it("counts Clef's account as a judge", async () => {
		await machine.device.set("CLOUDFLARE_ACCOUNT_ID", "account");
		await machine.device.set("CLOUDFLARE_API_TOKEN", "token");

		expect((await statuses())["auto-pick-judge"]).toBe("done");
	});

	it("keeps the defaults on Next with no rules saved, which leaves the try done too", async () => {
		await setup.submit("auto-pick-rules", {});

		expect(JSON.parse(await machine.fs.read(`${HOME}/auto-pick.json`))).toEqual(
			DEFAULT_RULES,
		);
		expect(await statuses()).toMatchObject({
			"auto-pick-rules": "done",
			"auto-pick-try": "done",
		});
	});

	it("undoes by deleting the rules and forgetting Jev's key, last first", async () => {
		await machine.device.set("TYPESAFE_API_KEY", "key");
		await setup.submit("auto-pick-rules", {});

		expect(await setup.undoPlan("auto-pick")).toMatchObject({
			steps: [
				{ id: "auto-pick-try", removes: [], leaves: [] },
				{
					id: "auto-pick-judge",
					removes: ["The TypeSafe API key kept on this device"],
					leaves: [
						"The key still works: revoke it in [TypeSafe](https://typesafe.ai) under API keys if you no longer want it.",
					],
				},
				{
					id: "auto-pick-rules",
					removes: [`Your Auto pick rules in \`${HOME}/auto-pick.json\``],
					leaves: [],
				},
			],
			creds: [{ name: "TYPESAFE_API_KEY", keptFor: null }],
		});
		await setup.undo("auto-pick", null);

		expect(await machine.fs.exists(`${HOME}/auto-pick.json`)).toBe(false);
		expect(await machine.device.get("TYPESAFE_API_KEY")).toBeUndefined();
		expect(await statuses()).toEqual({
			"auto-pick-judge": "ready",
			"auto-pick-rules": "ready",
			"auto-pick-try": "waiting",
		});
		await AUTO_PICK_AREA.steps[0]?.undo?.run(machine);
	});

	it("says Clef still judges once undone, its account kept for scry", async () => {
		await machine.device.set("CLOUDFLARE_ACCOUNT_ID", "account");
		await machine.device.set("CLOUDFLARE_API_TOKEN", "token");

		const plan = await setup.undoPlan("auto-pick");
		await setup.undo("auto-pick", null);

		expect(plan.steps).toEqual([
			{
				id: "auto-pick-judge",
				title: "Give Auto pick a decision model",
				done: true,
				removes: [],
				leaves: [
					"Auto pick still judges with Clef, on `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`, kept for scry's Workers AI: forget them on the Creds page to stop it.",
				],
			},
		]);
		expect(plan.creds).toEqual([
			{ name: "CLOUDFLARE_ACCOUNT_ID", keptFor: "scry's Workers AI" },
			{ name: "CLOUDFLARE_API_TOKEN", keptFor: "scry's Workers AI" },
		]);
		expect(await machine.device.get("CLOUDFLARE_API_TOKEN")).toBe("token");
	});

	it("leaves rules saved before as they are on Next", async () => {
		const mine = { ...DEFAULT_RULES, threshold: 0.7 };
		await machine.fs.write(`${HOME}/auto-pick.json`, JSON.stringify(mine));

		await setup.submit("auto-pick-rules", {});

		expect(JSON.parse(await machine.fs.read(`${HOME}/auto-pick.json`))).toEqual(
			mine,
		);
	});
});
