import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { FakeFs } from "webappwiz/system/testing";
import {
	Setup,
	type SetupArea,
	type SetupMachine,
	type SetupStep,
} from "./setup";
import { StepProblem } from "./step-problem";
import type { StepUndo } from "./undo";

const HOME = "/home/.splates";

describe("Setup's undo", () => {
	let device: FakeSecretStore;
	let machine: SetupMachine;
	let done: Set<string>;
	let ran: string[];

	beforeEach(() => {
		device = new FakeSecretStore();
		machine = { fs: new FakeFs(), home: HOME, device };
		done = new Set();
		ran = [];
	});

	/** A step done while `done` holds its id, whose undo takes it out. */
	function step(
		id: string,
		{
			after = [],
			cred,
			uses,
			undo = {},
		}: {
			after?: SetupStep[];
			cred?: string;
			uses?: string[];
			undo?: Partial<StepUndo> | null;
		} = {},
	): SetupStep {
		return {
			id,
			title: `Set up ${id}`,
			why: "",
			user: "",
			agent: "",
			optional: true,
			after,
			check: async () => done.has(id),
			fields:
				cred === undefined
					? undefined
					: [{ kind: "cred", name: cred, label: cred }],
			uses,
			undo:
				undo === null
					? undefined
					: {
							removes: async () => [`${id}'s thing`],
							run: async () => {
								ran.push(id);
								done.delete(id);
							},
							...undo,
						},
		};
	}

	function roster(): SetupArea[] {
		const token = step("token", { cred: "TOKEN" });
		const tunnel = step("tunnel", { after: [token], cred: "TUNNEL" });
		const workers = step("workers", { after: [tunnel], uses: ["TOKEN"] });
		return [
			{ id: "remote", title: "Remote", steps: [token, tunnel] },
			{ id: "workers", title: "Workers", steps: [workers] },
		];
	}

	it("plans the area's done steps last first, with what each removes", async () => {
		done.add("token").add("tunnel");
		await device.set("TOKEN", "t");
		await device.set("TUNNEL", "u");

		const plan = await new Setup(machine, roster()).undoPlan("remote");

		expect(plan).toEqual({
			area: "remote",
			title: "Remote",
			steps: [
				{
					id: "tunnel",
					title: "Set up tunnel",
					done: true,
					removes: ["tunnel's thing"],
					leaves: [],
				},
				{
					id: "token",
					title: "Set up token",
					done: true,
					removes: ["token's thing"],
					leaves: [],
				},
			],
			creds: [
				{ name: "TUNNEL", keptFor: null },
				{ name: "TOKEN", keptFor: null },
			],
			confirm: null,
			refused: null,
		});
	});

	it("runs each undo last first, then forgets the area's creds", async () => {
		done.add("token").add("tunnel");
		await device.set("TOKEN", "t");
		await device.set("TUNNEL", "u");

		const progress = await new Setup(machine, roster()).undo("remote", null);

		expect(ran).toEqual(["tunnel", "token"]);
		expect(await device.get("TOKEN")).toBeUndefined();
		expect(await device.get("TUNNEL")).toBeUndefined();
		expect(progress.areas[0]?.done).toBe(0);
	});

	it("refuses while a done step of another area needs one it undoes", async () => {
		done.add("token").add("tunnel").add("workers");
		const setup = new Setup(machine, roster());

		expect((await setup.undoPlan("remote")).refused).toBe(
			'Undo Workers first: its "Set up workers" needs "Set up tunnel".',
		);
		await expect(setup.undo("remote", null)).rejects.toThrow(StepProblem);
		expect(ran).toEqual([]);
	});

	it("keeps a cred a done step outside the area still uses", async () => {
		const token = step("token", { cred: "TOKEN" });
		const scry = step("scry", { uses: ["TOKEN"] });
		done.add("token").add("scry");
		await device.set("TOKEN", "t");
		const setup = new Setup(machine, [
			{ id: "remote", title: "Remote", steps: [token] },
			{ id: "scry", title: "Scry", steps: [scry] },
		]);

		expect((await setup.undoPlan("remote")).creds).toEqual([
			{ name: "TOKEN", keptFor: "Set up scry" },
		]);
		await setup.undo("remote", null);
		expect(await device.get("TOKEN")).toBe("t");
	});

	it("forgets a cred a done step outside the area only asks for", async () => {
		const token = step("token", { cred: "TOKEN" });
		const other = step("other", { cred: "TOKEN" });
		done.add("token").add("other");
		await device.set("TOKEN", "t");
		const setup = new Setup(machine, [
			{ id: "remote", title: "Remote", steps: [token] },
			{ id: "other", title: "Other", steps: [other] },
		]);

		expect((await setup.undoPlan("remote")).creds).toEqual([
			{ name: "TOKEN", keptFor: null },
		]);
		await setup.undo("remote", null);
		expect(await device.get("TOKEN")).toBeUndefined();
	});

	it("tells each undo what a done step outside the area still uses", async () => {
		const seen: string[][] = [];
		const choice = step("choice", {
			uses: ["cloud.json"],
			undo: {
				removes: async (_machine, kept) => {
					seen.push([...(kept ?? [])]);
					return kept?.has("cloud.json") ? [] : ["The cloud chosen"];
				},
				run: async (_machine, kept) => {
					seen.push([...(kept ?? [])]);
				},
			},
		});
		const box = step("box", { uses: ["cloud.json"] });
		done.add("choice").add("box");
		const setup = new Setup(machine, [
			{ id: "workers", title: "Workers", steps: [choice] },
			{ id: "cloud", title: "Cloud server", steps: [box] },
		]);

		expect((await setup.undoPlan("workers")).steps[0]?.removes).toEqual([]);
		await setup.undo("workers", null);
		expect(seen.at(-1)).toEqual(["cloud.json"]);
	});

	it("keeps a cred something outside setup uses", async () => {
		const judge = step("judge", { cred: "CLOUDFLARE_API_TOKEN" });
		done.add("judge");
		await device.set("CLOUDFLARE_API_TOKEN", "t");

		const plan = await new Setup(machine, [
			{ id: "auto-pick", title: "Auto pick", steps: [judge] },
		]).undoPlan("auto-pick");

		expect(plan.creds).toEqual([
			{ name: "CLOUDFLARE_API_TOKEN", keptFor: "scry's Workers AI" },
		]);
	});

	it("asks for the name a costly undo names, and goes once it is typed", async () => {
		const box = step("box", { undo: { confirm: async () => "splates-box" } });
		done.add("box");
		const setup = new Setup(machine, [
			{ id: "cloud", title: "Cloud server", steps: [box] },
		]);

		expect((await setup.undoPlan("cloud")).confirm).toBe("splates-box");
		await expect(setup.undo("cloud", "splates")).rejects.toThrow(
			"Type splates-box to undo Cloud server.",
		);
		await setup.undo("cloud", " splates-box ");
		expect(ran).toEqual(["box"]);
	});

	it("refuses what a step says it cannot undo now", async () => {
		const box = step("box", {
			undo: { refused: async () => "The server has moved to its box." },
		});
		done.add("box");

		await expect(
			new Setup(machine, [{ id: "cloud", title: "Cloud", steps: [box] }]).undo(
				"cloud",
				null,
			),
		).rejects.toThrow("The server has moved to its box.");
		expect(ran).toEqual([]);
	});

	it("stops at an undo that fails, keeping every cred for a second try", async () => {
		done.add("token").add("tunnel");
		await device.set("TOKEN", "t");
		const token = step("token", { cred: "TOKEN" });
		const tunnel = step("tunnel", {
			after: [token],
			undo: {
				run: async () => {
					throw new Error("Cloudflare said no");
				},
			},
		});

		await expect(
			new Setup(machine, [
				{ id: "remote", title: "Remote", steps: [token, tunnel] },
			]).undo("remote", null),
		).rejects.toThrow('Undoing "Set up tunnel" failed: Cloudflare said no');
		expect(ran).toEqual([]);
		expect(await device.get("TOKEN")).toBe("t");
	});

	it("only forgets the creds of a step with no undo of its own", async () => {
		const key = step("key", { cred: "KEY", undo: null });
		key.check = async () => (await device.get("KEY")) !== undefined;
		await device.set("KEY", "k");
		const setup = new Setup(machine, [
			{ id: "dictation", title: "Dictation", steps: [key] },
		]);

		const plan = await setup.undoPlan("dictation");
		await setup.undo("dictation", null);

		expect(plan.steps).toEqual([
			{ id: "key", title: "Set up key", done: true, removes: [], leaves: [] },
		]);
		expect(await device.get("KEY")).toBeUndefined();
	});

	it("undoes a journey left partway, its started step's cred and all", async () => {
		const token = step("token", { cred: "TOKEN" });
		const tunnel = step("tunnel", { after: [token], cred: "TUNNEL" });
		const workers = step("workers");
		done.add("token");
		await device.set("TOKEN", "t").then(() => device.set("TUNNEL", "u"));
		const setup = new Setup(machine, [
			{ id: "remote", title: "Remote", steps: [token, tunnel, workers] },
		]);

		expect((await setup.read()).areas[0]?.undoable).toBe(true);
		const plan = await setup.undoPlan("remote");
		await setup.undo("remote", null);

		expect(plan.steps.map(({ id, done }) => ({ id, done }))).toEqual([
			{ id: "tunnel", done: false },
			{ id: "token", done: true },
		]);
		expect(ran).toEqual(["tunnel", "token"]);
		expect(await device.get("TUNNEL")).toBeUndefined();
		expect((await setup.read()).areas[0]?.undoable).toBe(false);
	});

	it("finds nothing started by a cred another area's done step uses", async () => {
		const box = step("box", { cred: "TOKEN" });
		const snapshot = step("snapshot", { cred: "TOKEN", uses: ["TOKEN"] });
		done.add("snapshot");
		await device.set("TOKEN", "t");
		const setup = new Setup(machine, [
			{ id: "cloud", title: "Cloud server", steps: [box] },
			{ id: "workers", title: "Workers", steps: [snapshot] },
		]);

		expect((await setup.read()).areas.map((area) => area.undoable)).toEqual([
			false,
			true,
		]);
		expect((await setup.undoPlan("cloud")).steps).toEqual([]);
	});

	it("refuses an area not on the roster", async () => {
		await expect(new Setup(machine, roster()).undoPlan("nope")).rejects.toThrow(
			"no setup area 'nope'",
		);
	});
});
