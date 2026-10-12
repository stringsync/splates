import { describe, expect, it } from "bun:test";
import { Dispatch, promptFor } from "./dispatch";
import { Drafts, newDraft } from "./drafts";
import { conversation, details } from "./testing";

/** A storage that keeps nothing, so each test starts from empty drafts. */
const nowhere = {
	getItem: () => null,
	setItem: () => {},
	removeItem: () => {},
} as unknown as Storage;

const AGENTS = [{ id: "claude", name: "Claude", settings: [] }];

describe("Dispatch", () => {
	it("lists the listed conversations on a task, newest first, with what each needs", () => {
		const dispatch = new Dispatch(
			new Drafts(nowhere),
			null,
			AGENTS,
			[
				conversation({ id: "c3", task: "alpha", status: "running" }),
				conversation({ id: "c2", task: "beta" }),
				conversation({ id: "c1", task: "alpha", archived: true }),
				conversation({ id: "c0", task: "alpha", status: "stopped" }),
			],
			[details({ task: "alpha" })],
		);

		expect(
			dispatch
				.on("alpha")
				.map((row) => [row.conversation?.id, row.task?.task, row.need.kind]),
		).toEqual([
			["c3", "alpha", "working"],
			["c0", "alpha", "idle"],
		]);
	});

	it("offers every listed conversation to take work on, but those on the task already", () => {
		const dispatch = new Dispatch(
			new Drafts(nowhere),
			null,
			AGENTS,
			[
				conversation({ id: "c2", task: "alpha" }),
				conversation({ id: "c1", task: null }),
				conversation({ id: "c0", task: null, archived: true }),
			],
			[],
		);

		expect(
			dispatch.others({ kind: "task", task: "alpha" }).map((each) => each.id),
		).toEqual(["c1"]);
		expect(
			dispatch.others({ kind: "todo", id: 4 }).map((each) => each.id),
		).toEqual(["c2", "c1"]);
	});

	it("composes the prompt ahead of the draft a new conversation, one per tree, or a picked one already holds", () => {
		const drafts = new Drafts(nowhere);
		const dispatch = new Dispatch(drafts, "shop", AGENTS, [], []);
		drafts.write("c1", "and keep it small");

		expect([
			dispatch.start("codex", { kind: "todo", id: 12 }),
			dispatch.start("claude", { kind: "task", task: "alpha" }),
			dispatch.link("c1", { kind: "lane", id: 2 }),
			// Twice composes it once.
			dispatch.link("c1", { kind: "lane", id: 2 }),
		]).toEqual(["new/codex", "new/claude/alpha", "c1", "c1"]);
		expect([
			drafts.read(newDraft("shop")),
			drafts.read(newDraft("shop", "alpha")),
			drafts.read("c1"),
		]).toEqual([
			"[ARBOR TODO #12]",
			promptFor({ kind: "task", task: "alpha" }),
			"[ARBOR LANE 2]\n\nand keep it small",
		]);
	});

	it("asks for a task by claiming it", () => {
		expect(promptFor({ kind: "task", task: "alpha" })).toBe(
			"Run `arbor claim alpha` and carry on from its ARBOR.md.",
		);
	});
});
