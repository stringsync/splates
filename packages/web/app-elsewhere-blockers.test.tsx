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

	it("says on a card what it waits on there, and what there waits on it", async () => {
		const view = await testing.open({
			todos: [waiting({ id: 7 })],
			elsewhere: {
				blockers: { 7: [{ ...LOCALE, slug: "wren", status: "queued" }] },
				following: {
					7: [
						{
							blocker: 7,
							project: "/repos/shop",
							slug: "shop",
							id: 12,
							subject: "Checkout in euros",
							stage: "available",
						},
					],
				},
			},
		});

		const list = await waitFor(() =>
			view.getByRole("list", { name: "Backlog tasks" }),
		);
		const waits = within(list).getByTitle("#404 in wren, another project");
		expect(waits.getAttribute("href")).toContain("project=wren");
		expect(list.textContent).toContain("waits on");
		expect(list.textContent).toContain("queued");
		within(list).getByTitle("#12 in shop, another project");
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
