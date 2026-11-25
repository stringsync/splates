import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	cleanup,
	conversation,
	message,
	Testing,
	todo,
	waitFor,
	within,
} from "./testing";

const LOCALE = {
	project: "/repos/wren",
	id: 404,
	subject: "format() takes a locale",
};

/** The todo waiting on the locale change in wren. */
const waiting = (overrides: Parameters<typeof todo>[0]) =>
	todo({
		subject: "Show prices by locale",
		blockedElsewhere: [LOCALE],
		...overrides,
	});

describe("App's blockers in other projects", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("links a deferral's blocker there and resumes without it", async () => {
		const deferring = conversation({
			title: "Deferring",
			messages: [
				message(
					"agent",
					"## ⏸ Deferred locale-prices: waiting on wren #404\n\nIt set out to show prices by locale.",
				),
			],
		});
		const view = await testing.openConversations([deferring], undefined, {
			todos: [
				waiting({
					id: 20,
					deferred: {
						why: "Needs the locale change in wren.",
						at: "2026-10-27T10:00:00.000Z",
						task: "locale-prices",
						tasks: [LOCALE],
						questions: [],
						outside: [],
					},
				}),
			],
			elsewhere: {
				blockers: { 20: [{ ...LOCALE, slug: "wren", status: "working" }] },
				following: {},
			},
		});

		const card = await waitFor(() =>
			view.getByRole("region", { name: "deferred locale-prices" }),
		);
		within(card).getByTitle("#404 in wren, another project");
		expect(card.textContent).toContain("being worked on");
		expect(within(card).queryByRole("button", { name: /#404/ })).toBeNull();
		expect(within(card).queryByRole("button", { name: "Resume" })).toBeNull();
	});
});
