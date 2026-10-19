import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { FakeFs } from "webappwiz/system/testing";
import { Duration } from "webappwiz/time";
import { FakeTimer, FakeWallClock } from "webappwiz/time/testing";
import { RunStore } from "./runs";
import { Scheduler } from "./scheduler";
import type { Automation } from "./store";

describe("Scheduler", () => {
	let automations: Automation[];
	let clock: FakeWallClock;
	let ran: string[];
	let runs: RunStore;
	let scheduler: Scheduler | null;
	let timer: FakeTimer;

	const start = async () => {
		scheduler = await Scheduler.start({
			automations: async () => automations,
			clock,
			runs,
			now: () => new Date(clock.now()).toISOString(),
			actions: {
				run: async (command) => {
					ran.push(command);
				},
				agent: async (hook) => {
					ran.push(hook.prompt);
				},
				groom: async () => {
					ran.push("groom");
				},
			},
			log: new MemoryLogger(),
			timer,
		});
		return scheduler;
	};

	beforeEach(() => {
		automations = [
			{
				id: "1",
				trigger: { every: "1h" },
				hook: { kind: "run", command: "tidy" },
				createdAt: new Date(Date.UTC(2026, 9, 19, 9)).toISOString(),
			},
		];
		clock = new FakeWallClock(Date.UTC(2026, 9, 19, 9, 30));
		ran = [];
		runs = new RunStore("/hooks-runs.json", new FakeFs());
		scheduler = null;
		timer = new FakeTimer();
	});

	afterEach(() => scheduler?.dispose());

	it("runs each as it comes due, looking each minute", async () => {
		const running = await start();
		expect(ran).toEqual([]);

		clock.advance(Duration.mins(30));
		timer.fireIntervals();
		await running.look();

		expect(ran).toEqual(["tidy"]);
		expect((await runs.read())["1"]?.runs.map(({ on }) => on)).toEqual([
			"schedule",
		]);
	});

	it("runs one missed many times while down once as it starts", async () => {
		clock.advance(Duration.hrs(5));

		const running = await start();
		await running.look();

		expect(ran).toEqual(["tidy"]);
	});

	it("counts an edited schedule from the edit, not from a run on the old one", async () => {
		await runs.scheduled("1", automations[0]?.createdAt ?? "");
		automations = automations.map((each) => ({
			...each,
			trigger: { every: "2h" },
			editedAt: new Date(Date.UTC(2026, 9, 19, 10, 30)).toISOString(),
		}));
		clock.advance(Duration.hrs(2));

		const running = await start();
		expect(ran).toEqual([]);

		clock.advance(Duration.hrs(1));
		await running.look();
		expect(ran).toEqual(["tidy"]);
	});

	it("runs nothing paused", async () => {
		automations = automations.map((each) => ({ ...each, paused: true }));
		clock.advance(Duration.hrs(5));

		await start();

		expect(ran).toEqual([]);
	});
});
