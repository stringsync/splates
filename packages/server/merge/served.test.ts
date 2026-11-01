import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Exit } from "../exit";
import { Testing } from "../testing";
import { type MergeAsk, type RunMerge, ServedMerges } from "./served";

const ASK: MergeAsk = {
	task: "alpha",
	cwd: "/tmp/alpha",
	pid: 4242,
	hostname: "here",
	env: {},
	message: "",
};

describe("ServedMerges", () => {
	let deps: Testing;
	let runs: number;
	/** Ends the merge under way, as its run would. */
	let finish: (error?: unknown) => void;
	let run: RunMerge;
	beforeEach(async () => {
		deps = await Testing.open();
		runs = 0;
		finish = () => {};
		run = async (_ask, log, facts) => {
			runs++;
			log.info("rebased onto main");
			await new Promise<void>((resolve, reject) => {
				finish = (error) => (error === undefined ? resolve() : reject(error));
			});
			facts.commit = "abc1234";
		};
	});
	afterEach(() => deps.disposeAsync());

	it("tells the lines a merge logs and how it ended", async () => {
		const merges = new ServedMerges({
			storage: deps.storage,
			log: deps.log,
			run,
		});

		await merges.start(ASK);
		const first = await merges.read("alpha", 0, 1000);
		finish();
		const last = await merges.read("alpha", 1, 1000);

		expect(first).toEqual({
			lines: [{ level: "info", text: "rebased onto main" }],
			next: 1,
			end: null,
		});
		expect(last).toEqual({
			lines: [],
			next: 1,
			end: { facts: { commit: "abc1234" } },
		});
	});

	it("carries a refusal over as its reason, message and data", async () => {
		const merges = new ServedMerges({
			storage: deps.storage,
			log: deps.log,
			run,
		});

		await merges.start(ASK);
		finish(
			new Exit("conflict", "rebase onto main conflicted", { task: "alpha" }),
		);

		expect((await merges.read("alpha", 1, 1000))?.end?.exit).toEqual({
			reason: "conflict",
			message: "rebase onto main conflicted",
			data: { task: "alpha" },
		});
	});

	it("runs a merge once for the same command asking twice, and refuses another command meanwhile", async () => {
		const merges = new ServedMerges({
			storage: deps.storage,
			log: deps.log,
			run,
		});

		await merges.start(ASK);
		await merges.start(ASK);

		expect(runs).toBe(1);
		expect(merges.start({ ...ASK, pid: 7 })).rejects.toThrow(
			"already under way",
		);
	});

	it("runs a merge cut off by a restart again when its command asks again", async () => {
		const before = new ServedMerges({
			storage: deps.storage,
			log: deps.log,
			run,
		});
		await before.start(ASK);
		const after = new ServedMerges({
			storage: deps.storage,
			log: deps.log,
			run,
		});

		expect(await after.read("alpha", 0, 0)).toBeNull();
		await after.start(ASK);

		expect(runs).toBe(2);
		expect(after.running("alpha")).toBe(true);
	});

	it("gives the end a restart kept to the command that missed it, without running it again", async () => {
		const before = new ServedMerges({
			storage: deps.storage,
			log: deps.log,
			run,
		});
		await before.start(ASK);
		finish();
		await before.read("alpha", 1, 1000);
		const after = new ServedMerges({
			storage: deps.storage,
			log: deps.log,
			run,
		});

		await after.start(ASK);

		expect(runs).toBe(1);
		expect((await after.read("alpha", 0, 0))?.end).toEqual({
			facts: { commit: "abc1234" },
		});
	});

	it("forgets an end once its command has read it", async () => {
		const merges = new ServedMerges({
			storage: deps.storage,
			log: deps.log,
			run,
		});
		await merges.start(ASK);
		finish();
		await merges.read("alpha", 1, 1000);

		await merges.done("alpha", ASK.pid);

		expect(await merges.read("alpha", 0, 0)).toBeNull();
		expect(await deps.storage.collection("merge-queue").list()).toEqual([]);
	});
});
