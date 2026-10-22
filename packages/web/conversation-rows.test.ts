import "./register-dom";
import { describe, expect, it } from "bun:test";
import {
	type Need,
	type Needing,
	questions,
} from "@stringsync/splates-server/plans/browser";
import {
	isHostOf,
	nestRows,
	nextWaiting,
	rowsOf,
	shownIn,
	waitsOnYou,
} from "./conversation-rows";
import { nest } from "./parts";
import { conversation, details } from "./testing";

describe("conversation rows", () => {
	const asking: Need = {
		kind: "waiting",
		why: "questions",
		subject: "Which way?",
		since: null,
		questions: questions("# t\n\n## Blocked\n\n- [ ] 1. Which way?\n"),
	};
	const row = (id: string | null, task: string | null = null): Needing => ({
		conversation: id === null ? null : conversation({ id }),
		task: task === null ? null : details({ task }),
		need: { kind: "idle" },
	});
	const host = row("c1");
	const external = row(null, "beta");
	const part = row("c2");

	it("waits on you for no task an agent outside the page asks on, which asks in its own session", () => {
		expect(waitsOnYou({ ...external, need: asking })).toBe(false);
		expect(waitsOnYou({ ...host, need: asking })).toBe(true);
	});

	it("leaves out an external agent's task, the rows it holds in its place", () => {
		expect(
			shownIn([
				{
					row: host,
					parts: [{ row: external, parts: [{ row: part, parts: [] }] }],
				},
			]),
		).toEqual([{ row: host, parts: [{ row: part, parts: [] }] }]);
	});

	it("leaves out an agent handed out once it has exited, unless it asks or hosts one", () => {
		// each row made once: a conversation is stamped with when it was made,
		// so the same row made twice can differ by a millisecond
		const gone = (id: string, need: Need = { kind: "idle" }): Needing => ({
			...row(id),
			conversation: conversation({ id, status: "stopped" }),
			need,
		});
		const [top, idle, asks, hosts] = [
			gone("top"),
			gone("a"),
			gone("b", asking),
			gone("c"),
		];
		expect(
			shownIn([
				{
					row: top,
					parts: [
						{ row: idle, parts: [] },
						{ row: asks, parts: [] },
						{ row: hosts, parts: [{ row: part, parts: [] }] },
					],
				},
			]),
		).toEqual([
			{
				row: top,
				parts: [
					{ row: asks, parts: [] },
					{ row: hosts, parts: [{ row: part, parts: [] }] },
				],
			},
		]);
	});
	it("preserves first-host precedence, explicit roots and cycle recovery", () => {
		const tasks = [
			details({ task: "alpha" }),
			details({ task: "beta", base: "task/alpha", caller: "other" }),
		];
		const rows = rowsOf(tasks, [
			conversation({ id: "other", lastTask: "other" }),
			conversation({ id: "host", task: "alpha", lastTask: "alpha" }),
			conversation({ id: "part", task: "beta", lastTask: "beta" }),
			conversation({ id: "root", lastTask: "beta", parent: { id: null } }),
			conversation({ id: "cycle-one", parent: { id: "cycle-two" } }),
			conversation({ id: "cycle-two", parent: { id: "cycle-one" } }),
		]);
		expect(nestRows(tasks, rows)).toEqual(
			nest(rows, (host, part) => isHostOf(tasks, host, part)),
		);
	});

	const at = (id: string, task: string | null, need: Need): Needing => ({
		conversation: conversation({ id, task }),
		task: null,
		need,
	});
	const done: Need = { kind: "idle" };
	const rows = [
		at("open", "lane-a", done),
		at("other", "fix-b", asking),
		at("mate", "lane-a-more", asking),
		at("loose", null, asking),
	];
	const taken = { "lane-a": 1, "lane-a-more": 1 };

	it("opens next, on ⌥⌘M, one waiting on the open one's lane before those ahead of it", () => {
		expect(nextWaiting(rows, "open", taken)?.conversation?.id).toBe("mate");
	});

	it("keeps the list's order for ⌥⌘M off a lane, or with none of its lane waiting", () => {
		expect(nextWaiting(rows, "open", {})?.conversation?.id).toBe("other");
		expect(nextWaiting(rows, "loose", taken)?.conversation?.id).toBe("other");
		const waitless = rows.map((row) =>
			row.conversation?.id === "mate" ? { ...row, need: done } : row,
		);
		expect(nextWaiting(waitless, "open", taken)?.conversation?.id).toBe(
			"other",
		);
	});
});
