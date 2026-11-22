import { describe, expect, it } from "bun:test";
import type { SignalOverview, SignalRaise } from "@splates/server/signals";
import {
	busiestDay,
	cellOf,
	namespaceOf,
	namespacesOf,
	payloadColumns,
	raisesPerDay,
	removalOf,
	taskNumbers,
	usualRaiser,
	WHOLE,
} from "./signal-summary";

const raise = (
	at: string,
	payload: unknown = null,
	by = "splates",
): SignalRaise => ({
	at,
	by,
	payload,
});

const signal = (name: string, raises: SignalRaise[]): SignalOverview => ({
	name,
	project: name.split(".")[0] ?? name,
	probe: null,
	subscribers: [],
	raises,
});

describe("signal summary", () => {
	it("puts a signal in the namespace before its last dot", () => {
		expect(namespaceOf("mono.task.started")).toEqual({
			namespace: "mono.task",
			leaf: "started",
		});
		expect(namespaceOf("mdom.released")).toEqual({
			namespace: "mdom",
			leaf: "released",
		});
	});

	it("lists namespaces and their signals by latest raise, counting the namespace's raises", () => {
		const namespaces = namespacesOf([
			signal("mono.task.done", [raise("2026-11-19T10:00:00Z")]),
			signal("net.deployed", [raise("2026-11-19T09:00:00Z")]),
			signal("mono.task.started", [
				raise("2026-11-19T11:00:00Z"),
				raise("2026-11-18T11:00:00Z"),
			]),
		]);
		expect(namespaces.map((each) => [each.namespace, each.raises])).toEqual([
			["mono.task", 3],
			["net", 1],
		]);
		expect(namespaces[0]?.signals.map((each) => each.name)).toEqual([
			"mono.task.started",
			"mono.task.done",
		]);
	});

	it("counts raises per local day over the last week, today last", () => {
		const now = new Date(2026, 10, 19, 15).getTime();
		const days = raisesPerDay(
			[
				raise(new Date(2026, 10, 19, 9).toISOString()),
				raise(new Date(2026, 10, 19, 1).toISOString()),
				raise(new Date(2026, 10, 17, 23).toISOString()),
				raise(new Date(2026, 10, 10, 12).toISOString()),
			],
			now,
		);
		expect(days.map((day) => `${day.label} ${day.count}`)).toEqual([
			"Fri 0",
			"Sat 0",
			"Sun 0",
			"Mon 0",
			"Tue 1",
			"Wed 0",
			"Today 2",
		]);
		expect(busiestDay(days)?.label).toBe("Today");
		expect(busiestDay(days.map((day) => ({ ...day, count: 0 })))).toBeNull();
	});

	it("names who raised it most often", () => {
		expect(
			usualRaiser([
				raise("a", null, "x"),
				raise("b", null, "y"),
				raise("c", null, "y"),
			]),
		).toBe("y");
		expect(usualRaiser([])).toBeNull();
	});

	it("gives a column to each filled payload field, and one for payloads that are no object", () => {
		const raises = [
			raise("a", { numbers: [], task: "eval-picker" }),
			raise("b", { numbers: [3149], task: null }),
			raise("c", "plain"),
		];
		expect(payloadColumns(raises)).toEqual(["task", "numbers", WHOLE]);
		expect(cellOf(raises[0]?.payload, "task")).toBe("eval-picker");
		expect(cellOf(raises[2]?.payload, WHOLE)).toBe("plain");
		expect(cellOf(raises[0]?.payload, WHOLE)).toBeUndefined();
	});

	it("reads a numbers field of positive integers as task numbers", () => {
		expect(taskNumbers("numbers", [3149, 3150])).toEqual([3149, 3150]);
		expect(taskNumbers("numbers", ["x"])).toBeNull();
		expect(taskNumbers("ids", [1])).toBeNull();
	});
});

it("shows removal until a newer raise supplies the signal again", () => {
	const row = signal("aws.ready", []);
	row.subscribers = [
		{
			kind: "wait",
			id: "w",
			label: "ready",
			state: "removed",
			reason: "namespace undeclared",
			endedAt: "2026-11-19T12:00:00Z",
			live: false,
		},
	];
	expect(removalOf(row)).toBe("namespace undeclared");
	row.raises = [raise("2026-11-19T13:00:00Z")];
	expect(removalOf(row)).toBeUndefined();
});
