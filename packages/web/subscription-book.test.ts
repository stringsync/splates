import { describe, expect, it } from "bun:test";
import type { AutomationRow } from "@splates/server/hooks";
import {
	type ProjectAutomationsApi,
	SubscriptionBook,
} from "./subscription-book";

describe("SubscriptionBook", () => {
	it("lists every project's rows and skips one that cannot be read", async () => {
		const book = new SubscriptionBook(
			api({ a: [row("1")], b: [row("1")], c: [row("9")] }, ["c"]),
		);
		await book.load(["a", "b", "c"]);
		expect(book.all.map(({ project, row }) => `${project}/${row.id}`)).toEqual([
			"a/1",
			"b/1",
		]);
		expect(book.refusal).toContain("Not read");
	});

	it("changes one project's subscription and leaves the others", async () => {
		const book = new SubscriptionBook(api({ a: [row("1")], b: [row("1")] }));
		await book.load(["a", "b"]);
		expect(await book.pause("b", row("1"), true)).toBe(true);
		expect(book.all.map(({ project, row }) => [project, row.paused])).toEqual([
			["a", undefined],
			["b", true],
		]);
		await book.add("a", { signal: "x.y" }, { kind: "run", command: "ls" });
		await book.remove("b", row("1"));
		expect(book.all.map(({ project, row }) => `${project}/${row.id}`)).toEqual([
			"a/1",
			"a/2",
		]);
	});
});

const row = (id: string, paused?: boolean): AutomationRow => ({
	id,
	trigger: { signal: "mdom.released" },
	hook: { kind: "run", command: "true" },
	createdAt: "",
	when: "",
	does: "",
	runs: [],
	...(paused === undefined ? {} : { paused }),
});

function api(
	held: Record<string, AutomationRow[]>,
	failing: string[] = [],
): ProjectAutomationsApi {
	const read = async (project: string) => {
		if (failing.includes(project)) {
			throw new Error("down");
		}
		return held[project] ?? [];
	};
	return {
		read,
		add: async (project, trigger, hook) => {
			held[project] = [
				...(held[project] ?? []),
				{ ...row(String((held[project]?.length ?? 0) + 1)), trigger, hook },
			];
			return held[project] ?? [];
		},
		edit: read,
		remove: async (project, id) => {
			held[project] = (held[project] ?? []).filter((each) => each.id !== id);
			return held[project] ?? [];
		},
		pause: async (project, id, paused) => {
			held[project] = (held[project] ?? []).map((each) =>
				each.id === id ? { ...each, paused } : each,
			);
			return held[project] ?? [];
		},
	};
}
