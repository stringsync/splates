import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "core/log";
import { FakeTimer } from "core/time/testing";
import { taskAdd } from "../board";
import { Testing } from "../testing";
import { TaskSignals } from "./task-signals";

describe("TaskSignals", () => {
	let deps: Testing;
	let raised: string[];
	let signals: TaskSignals | null;
	let timer: FakeTimer;

	const follow = async () => {
		signals = await TaskSignals.follow({
			journal: deps.journal,
			log: new MemoryLogger(),
			raise: async (event) => {
				raised.push(`${event.name} ${event.numbers.join(",")}`);
			},
			timer,
		});
		return signals;
	};

	const look = async (following: TaskSignals) => {
		void following.changed();
		timer.fireTimeouts();
		await following.changed();
	};

	const add = (subject: string) =>
		deps.journal.record(
			"task add",
			null,
			() => taskAdd(deps, subject, null),
			(task) => ({
				number: task.id,
				subject: task.subject,
				lane: null,
				position: task.position,
			}),
		);

	beforeEach(async () => {
		deps = await Testing.open();
		raised = [];
		signals = null;
		timer = new FakeTimer();
	});

	afterEach(async () => {
		signals?.dispose();
		await deps.disposeAsync();
	});

	it("raises nothing for what came before it first followed", async () => {
		await add("Before");

		await look(await follow());

		expect(raised).toEqual([]);
	});

	it("raises each task event once, as the journal takes it", async () => {
		const following = await follow();
		await add("Totals first");

		await look(following);
		await look(following);

		expect(raised).toEqual(["task.created 1"]);
	});
});
