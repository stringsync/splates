import { beforeEach, describe, expect, it } from "bun:test";
import { ensure } from "core/assert";
import { MemoryLogger } from "core/log";
import { FakeFs, FakePs } from "core/system/testing";
import { Duration } from "core/time";
import { FakeWallClock } from "core/time/testing";
import { Exit } from "../exit";
import { FsStorage } from "../storage";
import { quietly } from "./npm-terminal";
import type { Ship } from "./record";
import { eventsText, type ReleaseStep } from "./release-steps";
import { Shipping } from "./run";
import { FakeReleaseGit, nth, until } from "./testing";

describe("Shipping", () => {
	let shipping: Shipping;
	let ps: FakePs;
	let fs: FakeFs;
	let storage: FsStorage;

	beforeEach(async () => {
		({ shipping, ps, fs, storage } = await project());
	});

	it("runs the ship command in the root with its approved bump", async () => {
		const started = await shipping.start("minor");
		const child = await nth(ps, 0);
		child.print("published 0.1.0\n");
		child.exit(0);
		await shipping.settled();

		expect(started).toMatchObject({
			project: "demo",
			status: "running",
			bump: "minor",
		});
		expect(ps.getCalls()).toEqual([quietly("wiz dev ship").join(" ")]);
		expect(ps.getCallDirs()).toEqual(["/demo"]);
		expect(ps.getCallEnvs()).toEqual([
			{
				npm_config_browser: "false",
				SPLATES_SHIP_EVENTS: `${shipping.output}.events`,
				SPLATES_SHIP_ANSWERS: shipping.answers,
			},
		]);
		expect(await shipping.current()).toMatchObject({
			status: "done",
			step: "ship",
			from: "0.0.57",
			ended: "2026-10-27T12:00:00.000Z",
		});
		expect(await fs.read(shipping.output)).toBe("published 0.1.0\n");
	});

	it("runs declared inputs and resumes with exactly those values", async () => {
		const inputs = { bump: "major", prod: false, region: "east=1" };
		const started = await shipping.start("patch", { planned: true, inputs });
		expect(started.inputs).toEqual(inputs);
		expect((await shipping.current())?.inputs).toEqual(inputs);
		const child = await nth(ps, 0);
		expect(ps.getCalls()[0]).toBe(
			quietly(
				"wiz dev ship --input 'bump=major' --input 'prod=false' --input 'region=east=1'",
			).join(" "),
		);
		expect(ps.getCallEnvs()[0]).not.toHaveProperty("SPLATES_SHIP_BUMP");
		child.exit(0);
		await shipping.settled();
		await storage
			.document<Ship>("ship.json")
			.update((ship) => ({ ...ensure.present(ship), status: "running" }));
		await shipping.resume();
		const resumed = await nth(ps, 1);
		expect(ps.getCalls()[1]).toBe(ps.getCalls()[0]);
		resumed.exit(0);
		await shipping.settled();
	});

	it("waits for a correlated answer without typing at a planned terminal", async () => {
		const ship = await shipping.start("patch", { planned: true });
		const child = await nth(ps, 0);
		child.print("Deploy? (y/n)");
		const events = eventsText([
			{
				type: "declared",
				id: "deploy",
				name: "Deploy",
				stage: "publish",
				packages: [],
				deadlineMs: 5000,
				at: "t0",
			},
			{ type: "started", id: "deploy", name: "Deploy", at: "t1" },
			{
				type: "ask",
				id: "deploy",
				name: "Deploy",
				questionId: "q1",
				question: "Deploy?",
				at: "t2",
			},
		]);
		await fs.write(shipping.events, events);
		await until(
			async () =>
				(await shipping.current())?.stages?.some(
					(stage) => stage.state === "asking",
				) === true,
		);
		expect(child.typed).toEqual([]);
		expect(shipping.answer("stale-run", "q1", true)).rejects.toThrow();
		expect(
			shipping.answer(ship.started, "stale-question", true),
		).rejects.toThrow();
		await shipping.answer(ship.started, "q1", false);
		expect(await fs.read(shipping.answers)).toBe(
			'{"questionId":"q1","answer":false}\n',
		);
		expect(shipping.answer(ship.started, "q1", true)).rejects.toThrow();
		await fs.append(
			shipping.events,
			eventsText([
				{
					type: "answered",
					id: "deploy",
					name: "Deploy",
					questionId: "q1",
					answer: false,
					at: "t3",
				},
			]),
		);
		child.exit(1);
		await shipping.settled();
		expect((await shipping.current())?.status).toBe("failed");
	});

	it("lets a planned command own its release checks", async () => {
		const git = new FakeReleaseGit();
		git.failAt = 1;
		({ shipping, ps } = await project({ git }));
		await shipping.start("patch", { planned: true });
		(await nth(ps, 0)).exit(0);
		await shipping.settled();
		expect((await shipping.current())?.status).toBe("done");
		expect(git.calls).toBe(0);
	});

	it("prepares the root before the ship command, so its checks have what a merge added", async () => {
		({ shipping, ps } = await project({ prepare: "bun install" }));
		await shipping.start();
		const install = await nth(ps, 0);
		expect(ps.getCalls()).toEqual(["sh -c bun install"]);
		expect(ps.getCallDirs()).toEqual(["/demo"]);
		install.exit(0);
		const child = await nth(ps, 1);
		child.exit(0);
		await shipping.settled();

		expect(ps.getCalls()[1]).toBe(quietly("wiz dev ship").join(" "));
		expect(await shipping.current()).toMatchObject({ status: "done" });
	});

	it("fails the ship without running its command when preparing fails", async () => {
		({ shipping, ps } = await project({ prepare: "bun install" }));
		await shipping.start();
		(await nth(ps, 0)).exit(1);
		await shipping.settled();

		expect(ps.getCalls()).toEqual(["sh -c bun install"]);
		expect(await shipping.current()).toMatchObject({
			status: "failed",
			error: "bun install exited 1",
		});
	});

	it("keeps the release steps its command writes, and names the one that failed", async () => {
		await shipping.start();
		const child = await nth(ps, 0);
		await fs.write(
			`${shipping.output}.events`,
			`${eventsText([
				{
					type: "declared",
					id: "build",
					name: "Build",
					stage: "build",
					packages: ["a"],
					deadlineMs: 1000,
					at: "t0",
				},
				{
					type: "declared",
					id: "tag",
					name: "Tag",
					stage: "tag",
					packages: [],
					deadlineMs: 1000,
					at: "t0",
				},
				{ type: "started", id: "build", name: "Build", at: "t1" },
				{
					type: "failed",
					id: "build",
					name: "Build",
					error: "tsc broke",
					at: "t2",
				},
			])}not json\n`,
		);
		child.exit(1);
		await shipping.settled();
		const ship = await shipping.current();
		const command = ship?.stages?.find((each) => each.key === "command");
		expect(command?.releaseSteps?.map((each) => [each.id, each.state])).toEqual(
			[
				["build", "failed"],
				["tag", "pending"],
			],
		);
		expect(ship?.error).toBe('release step "Build" failed: tsc broke');
	});

	it("keeps no release steps when its command writes none", async () => {
		await shipping.start();
		(await nth(ps, 0)).exit(0);
		await shipping.settled();
		expect(
			(await shipping.current())?.stages?.find((each) => each.key === "command")
				?.releaseSteps,
		).toBeUndefined();
		expect((await shipping.current())?.status).toBe("done");
	});

	it("runs the command through sh with echo off", () => {
		expect(quietly("wiz dev ship")).toEqual([
			"sh",
			"-c",
			"stty -echo 2>/dev/null; wiz dev ship",
		]);
	});

	it("does not type an answer at a terminal prompt", async () => {
		await shipping.start();
		const ship = await nth(ps, 0);
		ship.print("\u001b[33mpublish 2 packages as 0.0.58? (y/n)\u001b[39m ");
		await Bun.sleep(25);

		ship.exit(0);
		await shipping.settled();
		expect(ship.typed).toEqual([]);
	});

	it("keeps the end of the output as why a ship failed", async () => {
		await shipping.start();
		const ship = await nth(ps, 0);
		ship.print("npm error 403 Forbidden\n");
		ship.exit(1);
		await shipping.settled();

		const failed = await shipping.current();
		expect(failed?.status).toBe("failed");
		expect(failed?.error).toContain("wiz dev ship exited 1");
		expect(failed?.error).toContain("npm error 403 Forbidden");
	});

	it("refuses a second ship while one runs, and a project that names none", async () => {
		await shipping.start();

		const again = await shipping.start().catch((error) => error);

		expect((again as Exit).reason).toBe("conflict");
		(await nth(ps, 0)).exit(0);
		await shipping.settled();

		const { shipping: none } = await project({ command: null });
		const refused = await none.start().catch((error) => error);
		expect(refused).toBeInstanceOf(Exit);
		expect((refused as Exit).reason).toBe("not_found");
	});

	it("slices the log by release step, by when its output came", async () => {
		const clock = new FakeWallClock(Date.parse("2026-10-27T12:00:00.000Z"));
		({ shipping, ps, fs } = await project({ clock }));
		const followed: ReleaseStep[][] = [];
		const following = shipping.followSteps(async (steps) => {
			followed.push(steps);
		});
		await shipping.start();
		const child = await nth(ps, 0);
		const printed = async (text: string) => {
			child.print(text);
			await until(async () => (await fs.read(shipping.output)).endsWith(text));
			clock.advance(Duration.secs(1));
		};
		const now = () => new Date(clock.now()).toISOString();
		const events: Record<string, unknown>[] = [
			{
				type: "declared",
				id: "build",
				name: "Build",
				stage: "build",
				packages: [],
				deadlineMs: 1000,
				at: now(),
			},
		];
		const write = (event: Record<string, unknown>) => {
			events.push(event);
			return fs.write(`${shipping.output}.events`, eventsText(events));
		};
		await printed("preflight noise\n");
		await write({ type: "started", id: "build", name: "Build", at: now() });
		clock.advance(Duration.secs(1));
		await printed("building\nbuilt\n");
		await write({ type: "done", id: "build", name: "Build", at: now() });
		clock.advance(Duration.secs(1));
		await printed("summary\n");
		child.exit(0);
		await shipping.settled();
		following.dispose();

		const command = (await shipping.current())?.stages?.find(
			(each) => each.key === "command",
		);
		const log = command?.releaseSteps?.[0]?.log;
		const bytes = await fs.readBytes(shipping.output);
		expect(
			new TextDecoder().decode(bytes.slice(log?.from, log?.to ?? undefined)),
		).toBe("building\nbuilt\n");
		expect(followed.at(-1)?.[0]?.log).toEqual(log);
	});

	it("records its steps, each with its slice of the log", async () => {
		await shipping.start();
		const ship = await nth(ps, 0);
		ship.print("building\npublished 0.0.58\n");
		ship.exit(0);
		await shipping.settled();

		const stages = (await shipping.current())?.stages ?? [];
		expect(stages.map((stage) => [stage.key, stage.state])).toEqual([
			["push", "skipped"],
			["command", "done"],
			["remote", "skipped"],
		]);
		expect(stages[1]).toMatchObject({
			started: "2026-10-27T12:00:00.000Z",
			ended: "2026-10-27T12:00:00.000Z",
			log: { from: 0, to: 26 },
		});
	});

	it("adds to a log its cascade names, its slices counted from what was there", async () => {
		await fs.mkdir("/history/one", { recursive: true });
		await fs.write("/history/one/demo.log", "before\n");
		await shipping.start("patch", { log: "/history/one/demo.log" });
		const ship = await nth(ps, 0);
		ship.print("again\n");
		ship.exit(0);
		await shipping.settled();

		expect(await fs.read("/history/one/demo.log")).toBe("before\nagain\n");
		expect(await shipping.outputOf()).toBe("/history/one/demo.log");
		expect(
			(await shipping.current())?.stages?.find((each) => each.key === "command")
				?.log,
		).toEqual({ from: 7, to: 13 });
	});

	it("stops the ship under way at the person's word, failed", async () => {
		await shipping.start();
		const ship = await nth(ps, 0);
		const stopping = shipping.stop();
		ship.exit(143);
		await stopping;

		expect(await shipping.current()).toMatchObject({
			status: "failed",
			error: "stopped: the person abandoned the ship",
		});
		expect(
			(await shipping.current())?.stages?.map((stage) => stage.state),
		).toEqual(["skipped", "failed", "skipped"]);
	});

	it("runs again a stopped server's ship at the bump it recorded", async () => {
		await shipping.start("major");
		await nth(ps, 0);
		shipping.dispose();
		await shipping.settled();
		expect((await shipping.current())?.status).toBe("running");

		const { shipping: restarted, ps: after } = await project({ storage, fs });
		await restarted.resume();
		(await nth(after, 0)).exit(0);
		await restarted.settled();

		expect(after.getCallEnvs()[0]).toEqual({
			npm_config_browser: "false",
			SPLATES_SHIP_EVENTS: `${restarted.output}.events`,
			SPLATES_SHIP_ANSWERS: restarted.answers,
		});
		expect(await restarted.current()).toMatchObject({
			status: "done",
			bump: "major",
			resumed: 1,
		});
	});
});

async function project({
	command = "wiz dev ship" as string | null,
	fs = new FakeFs(),
	storage = new FsStorage("/home/projects/1", fs),
	git = new FakeReleaseGit(),
	prepare = null as string | null,
	clock = new FakeWallClock(Date.parse("2026-10-27T12:00:00.000Z")),
}: {
	clock?: FakeWallClock;
	command?: string | null;
	prepare?: string | null;
	fs?: FakeFs;
	storage?: FsStorage;
	git?: FakeReleaseGit;
} = {}) {
	await fs.mkdir("/demo", { recursive: true });
	await fs.write(
		"/demo/package.json",
		JSON.stringify({ name: "demo", version: "0.0.57" }),
	);
	const ps = new FakePs();
	const shipping = new Shipping({
		storage,

		fs,
		ps,
		log: new MemoryLogger(),
		root: "/demo",
		dir: "/home/projects/1",
		command,
		prepare,
		slug: async () => "demo",
		clock,
	});
	return { shipping, ps, fs, storage, git };
}
