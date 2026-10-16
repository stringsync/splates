import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { FakeFs } from "webappwiz/system/testing";
import {
	Setup,
	type SetupArea,
	type SetupMachine,
	type SetupStep,
} from "./setup";

const HOME = "/home/.arbor";

/** A step whose check answers whatever `done` holds for its id. */
function fake(
	id: string,
	done: Set<string>,
	{
		optional = false,
		after = [],
	}: { optional?: boolean; after?: SetupStep[] } = {},
): SetupStep {
	return {
		id,
		title: `Set up ${id}`,
		why: `${id} matters.`,
		user: `Do ${id}.`,
		agent: `Help with ${id}.`,
		optional,
		after,
		check: async () => done.has(id),
	};
}

describe("Setup", () => {
	let machine: SetupMachine;
	let done: Set<string>;

	beforeEach(() => {
		machine = { fs: new FakeFs(), home: HOME, device: new FakeSecretStore() };
		done = new Set();
	});

	function roster(): SetupArea[] {
		const host = fake("host", done);
		const access = fake("access", done, { after: [host] });
		const slots = fake("slots", done, { optional: true, after: [access] });
		const key = fake("key", done, { optional: true });
		return [
			{ id: "remote", title: "Remote", steps: [host, access, slots] },
			{ id: "dictation", title: "Dictation", steps: [key] },
		];
	}

	it("checks each step from real state and offers the first ready required one", async () => {
		const setup = new Setup(machine, roster());

		const first = await setup.read();
		done.add("host");
		const second = await setup.read();

		expect(first.areas[0]?.steps.map((step) => step.status)).toEqual([
			"ready",
			"waiting",
			"waiting",
		]);
		expect(first.next).toBe("host");
		expect(first.required).toBe(true);
		expect(second.areas[0]).toMatchObject({ done: 1, skipped: 0, left: 2 });
		expect(second.next).toBe("access");
	});

	it("offers an optional step once no required one is left", async () => {
		done.add("host").add("access");

		const progress = await new Setup(machine, roster()).read();

		expect(progress.required).toBe(false);
		expect(progress.next).toBe("slots");
	});

	it("keeps a skip per machine, skipping what waits on it, until unskipped", async () => {
		const setup = new Setup(machine, roster());

		await setup.skip("access");
		const skipped = await new Setup(machine, roster()).read();
		await setup.unskip("access");
		const unskipped = await setup.read();

		expect(skipped.areas[0]?.steps.map((step) => step.status)).toEqual([
			"ready",
			"skipped",
			"skipped",
		]);
		expect(JSON.parse(await machine.fs.read(`${HOME}/setup.json`))).toEqual({
			format: 1,
			skipped: [],
		});
		expect(unskipped.areas[0]?.skipped).toBe(0);
	});

	it("is fresh until setup is seen or a step skipped", async () => {
		const setup = new Setup(machine, roster());

		const fresh = await setup.read();
		await setup.see();
		const seen = await setup.read();

		expect(fresh.fresh).toBe(true);
		expect(seen.fresh).toBe(false);
	});

	it("keeps what was skipped when setup is seen again", async () => {
		const setup = new Setup(machine, roster());
		await setup.skip("key");

		await setup.see();

		expect((await setup.read()).areas[1]?.skipped).toBe(1);
	});

	it("counts a done step as done although it was skipped", async () => {
		const setup = new Setup(machine, roster());
		await setup.skip("key");
		done.add("key");

		const progress = await setup.read();

		expect(progress.areas[1]).toMatchObject({ done: 1, skipped: 0, left: 0 });
	});

	it("reports a check that throws as the step's problem", async () => {
		const broken: SetupStep = {
			...fake("broken", done),
			check: async () => {
				throw new Error("the store is locked");
			},
		};

		const progress = await new Setup(machine, [
			{ id: "area", title: "Area", steps: [broken] },
		]).read();

		expect(progress.areas[0]?.steps[0]).toMatchObject({
			status: "ready",
			problem: "the store is locked",
		});
	});

	it("refuses a step not on the roster", async () => {
		const setup = new Setup(machine, roster());

		await expect(setup.skip("nope")).rejects.toThrow("no setup step 'nope'");
	});

	it("refuses a roster whose step waits on one not before it", () => {
		const later = fake("later", done);
		const early = fake("early", done, { after: [later] });

		expect(
			() =>
				new Setup(machine, [
					{ id: "area", title: "Area", steps: [early, later] },
				]),
		).toThrow("setup step 'early' waits on 'later'");
	});

	it("refuses a roster that names a step twice", () => {
		expect(
			() =>
				new Setup(machine, [
					{ id: "a", title: "A", steps: [fake("same", done)] },
					{ id: "b", title: "B", steps: [fake("same", done)] },
				]),
		).toThrow("setup names step 'same' twice");
	});
});
