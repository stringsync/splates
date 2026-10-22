import { describe, expect, test } from "bun:test";
import { MemoryStorage } from "../storage/testing";
import {
	RUNNER_DAYS,
	type RunnerJobRow,
	type RunnerRow,
	runnersReport,
	Spend,
	type SpendEntry,
} from "./index";

describe("runnersReport", () => {
	test("lists every runner newest first, with its hours, dollars and jobs, one up now counted to now", () => {
		const report = runnersReport(
			[
				made("old", "2026-10-21T10:00:00.000Z"),
				job(
					"j1",
					"old",
					"fix",
					"2026-10-21T10:05:00.000Z",
					"2026-10-21T10:06:00.000Z",
				),
				ended("old", "2026-10-21T12:30:00.000Z"),
				made("up", "2026-10-22T10:00:00.000Z", 0.25),
			],
			NOW,
			[job("j2", "up", "fix", "2026-10-22T11:59:00.000Z", null)],
		);

		expect(report.runners).toEqual([
			{
				id: "up",
				type: "c-16",
				provider: "digitalocean",
				dollarsPerHour: 0.25,
				from: "2026-10-22T10:00:00.000Z",
				until: null,
				hours: 2,
				dollars: 0.5,
				jobs: 1,
			},
			{
				id: "old",
				type: "c-16",
				provider: "digitalocean",
				dollarsPerHour: 0.5,
				from: "2026-10-21T10:00:00.000Z",
				until: "2026-10-21T12:30:00.000Z",
				hours: 2.5,
				dollars: 1.25,
				jobs: 1,
			},
		]);
	});

	test("keeps when a runner was made through a price set again, and its first end", () => {
		const report = runnersReport(
			[
				made("r", "2026-10-22T10:00:00.000Z", 0.5),
				made("r", "2026-10-22T10:01:00.000Z", 0.2),
				ended("r", "2026-10-22T11:00:00.000Z"),
				ended("r", "2026-10-22T11:30:00.000Z"),
			],
			NOW,
		);

		expect(report.runners[0]).toMatchObject({
			from: "2026-10-22T10:00:00.000Z",
			until: "2026-10-22T11:00:00.000Z",
			dollarsPerHour: 0.2,
			hours: 1,
		});
	});

	test("counts each of the last 90 days, a runner across midnight split between them", () => {
		const report = runnersReport(
			[
				made("r", "2026-10-21T23:00:00.000Z"),
				ended("r", "2026-10-22T01:00:00.000Z"),
			],
			NOW,
		);

		expect(report.days).toHaveLength(RUNNER_DAYS);
		expect(report.days.at(-1)).toEqual({
			period: "2026-10-22",
			hours: 1,
			dollars: 0.5,
		});
		expect(report.days.at(-2)).toEqual({
			period: "2026-10-21",
			hours: 1,
			dollars: 0.5,
		});
		expect(report.days[0]?.period).toBe("2026-07-25");
	});

	test("sets each month's estimate beside what its provider billed, and how far off it is", () => {
		const report = runnersReport(
			[
				made("r", "2026-09-30T20:00:00.000Z"),
				ended("r", "2026-10-01T04:00:00.000Z"),
				bill("2026-09-01T00:00:00.000Z", 2.5),
				// Another provider's bill is not the runners'.
				{ ...bill("2026-09-01T00:00:00.000Z", 9), provider: "cloudflare" },
			],
			NOW,
		);

		expect(report.months).toEqual([
			{ period: "2026-09-01", hours: 4, dollars: 2, billed: 2.5, gap: -20 },
			{ period: "2026-10-01", hours: 4, dollars: 2, billed: null, gap: null },
		]);
	});

	test("shares each hour of a runner among the tasks whose jobs ran on it then, by how long each ran", () => {
		const report = runnersReport(
			[
				made("r", "2026-10-22T10:00:00.000Z"),
				job(
					"a",
					"r",
					"one",
					"2026-10-22T10:00:00.000Z",
					"2026-10-22T10:01:00.000Z",
				),
				job(
					"b",
					"r",
					"two",
					"2026-10-22T10:30:00.000Z",
					"2026-10-22T10:32:00.000Z",
				),
				ended("r", "2026-10-22T12:00:00.000Z"),
			],
			NOW,
		);

		const [day] = report.split.days;
		expect(day?.period).toBe("2026-10-22");
		const shares = Object.fromEntries(
			(day?.shares ?? []).map((share) => [
				share.task ?? "idle",
				Number(share.dollars.toFixed(4)),
			]),
		);
		// The first hour's $0.50 goes 1:2 by minutes run; the second, no job ran in.
		expect(shares).toEqual({ one: 0.1667, two: 0.3333, idle: 0.5 });
		expect(report.split.months.map((each) => each.period)).toEqual([
			"2026-10-01",
		]);
	});

	test("the ledger keeps runners' rows apart from amounts spent", async () => {
		const spend = new Spend(new MemoryStorage());
		await spend.note(made("r", "2026-10-22T10:00:00.000Z"));
		await spend.record(bill("2026-09-01T00:00:00.000Z", 3));

		expect(await spend.entries()).toEqual([
			bill("2026-09-01T00:00:00.000Z", 3),
		]);
		expect((await spend.totals()).map((each) => each.billed)).toEqual([3]);
		expect(await spend.lines()).toHaveLength(2);
	});
});

const made = (id: string, at: string, dollarsPerHour = 0.5): RunnerRow => ({
	row: "runner",
	id,
	type: "c-16",
	provider: "digitalocean",
	dollarsPerHour,
	at,
});

const ended = (id: string, at: string): RunnerRow => ({
	row: "runner-ended",
	id,
	at,
});

const job = (
	id: string,
	runner: string,
	task: string,
	at: string,
	until: string | null,
): RunnerJobRow => ({
	row: "job",
	id,
	runner,
	project: "/p",
	task,
	what: "bun test",
	at,
	until,
});

const bill = (at: string, dollars: number): SpendEntry => ({
	at,
	provider: "digitalocean",
	service: "droplets",
	kind: "billed",
	dollars,
	project: null,
	task: null,
	conversation: null,
	ref: `digitalocean:${at}`,
});

const NOW = Date.parse("2026-10-22T12:00:00.000Z");
