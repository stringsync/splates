import { describe, expect, it } from "bun:test";
import { type Searched, search } from "./search";
import { conversation, details, todo } from "./testing";

function searched(overrides: Partial<Searched> = {}): Searched {
	return {
		tasks: [],
		todos: [],
		conversations: [],
		lanes: [],
		...overrides,
	};
}

const titles = (query: string, of: Searched) =>
	search(query, of).map(({ kind, found }) => [
		kind,
		found.map((each) => each.title),
	]);

describe("search", () => {
	it("ranks a title's start over a word in it over anywhere in it", () => {
		const of = searched({
			todos: [
				todo({ id: 1, subject: "Reupload the logo" }),
				todo({ id: 2, subject: "Retry the upload" }),
				todo({ id: 3, subject: "Upload retries forever" }),
			],
		});
		expect(titles("upload", of)).toEqual([
			[
				"todo",
				["Upload retries forever", "Retry the upload", "Reupload the logo"],
			],
		]);
	});

	it("needs every word, in the title or the body", () => {
		const of = searched({
			todos: [
				todo({ id: 1, subject: "Retry the upload", text: "on a 413" }),
				todo({ id: 2, subject: "Retry the download" }),
			],
		});
		expect(titles("retry 413", of)).toEqual([["todo", ["Retry the upload"]]]);
	});

	it("shows where a body matched", () => {
		const of = searched({
			conversations: [
				conversation({
					id: "c1",
					name: "Chat",
					messages: [
						{
							role: "user",
							parts: [{ type: "text", text: "Why does the upload fail?" }],
							plan: null,
							at: null,
							until: null,
						},
					],
				}),
			],
		});
		const [group] = search("fail", of);
		expect(group?.found[0]?.detail).toBe("Why does the upload fail?");
	});

	it("puts the kind with the best match first", () => {
		const of = searched({
			tasks: [details({ task: "lexical-upload" })],
			todos: [todo({ id: 1, subject: "Upload retries" })],
		});
		expect(search("upload", of).map((group) => group.kind)).toEqual([
			"todo",
			"task",
		]);
	});

	it("breaks a tie by the latest", () => {
		const of = searched({
			todos: [
				todo({ id: 1, subject: "Upload a", createdAt: "2026-01-01" }),
				todo({ id: 2, subject: "Upload b", createdAt: "2026-02-01" }),
			],
		});
		expect(titles("upload", of)).toEqual([["todo", ["Upload b", "Upload a"]]]);
	});

	it("lists what wants the person first when nothing is typed", () => {
		const of = searched({
			tasks: [
				details({ task: "newer", createdAt: "2026-02-01" }),
				details({
					task: "stuck",
					createdAt: "2026-01-01",
					escalation: "needs a call",
				}),
			],
			conversations: [
				conversation({ id: "a", name: "Quiet" }),
				conversation({ id: "b", name: "Asking", unread: true }),
				conversation({ id: "c", name: "Gone", archived: true }),
			],
		});
		expect(titles("", of)).toEqual([
			["task", ["stuck", "newer"]],
			["conversation", ["Asking", "Quiet"]],
		]);
	});
});
