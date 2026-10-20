import "./register-dom";
import { describe, expect, it } from "bun:test";
import {
	type Need,
	type Needing,
	questions,
} from "@stringsync/splates-server/plans/browser";
import { shownIn, waitsOnYou } from "./conversation-rows";
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
		const gone = (id: string, need: Need = { kind: "idle" }): Needing => ({
			...row(id),
			conversation: conversation({ id, status: "stopped" }),
			need,
		});
		expect(
			shownIn([
				{
					row: gone("top"),
					parts: [
						{ row: gone("a"), parts: [] },
						{ row: gone("b", asking), parts: [] },
						{ row: gone("c"), parts: [{ row: part, parts: [] }] },
					],
				},
			]),
		).toEqual([
			{
				row: gone("top"),
				parts: [
					{ row: gone("b", asking), parts: [] },
					{ row: gone("c"), parts: [{ row: part, parts: [] }] },
				],
			},
		]);
	});
});
