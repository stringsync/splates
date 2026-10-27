import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	cleanup,
	conversation,
	fireEvent,
	message,
	Testing,
	todo,
	waitFor,
	within,
} from "./testing";

const LOCALE = {
	project: "/repos/webappwiz",
	id: 404,
	subject: "format() takes a locale",
};

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
			todos: [
				todo({
					id: 7,
					subject: "Show prices by locale",
					blockedElsewhere: [LOCALE],
				}),
			],
			lanes: [],
			elsewhere: {
				blockers: { 7: [{ ...LOCALE, slug: "webappwiz", status: "queued" }] },
				following: {
					7: [
						{
							blocker: 7,
							project: "/repos/shop",
							slug: "shop",
							id: 12,
							subject: "Checkout in euros",
							stage: "ready",
						},
					],
				},
			},
		});

		const list = await waitFor(() =>
			view.getByRole("list", { name: "Untriaged tasks" }),
		);
		const waits = within(list).getByTitle("#404 in webappwiz, another project");
		expect(waits.getAttribute("href")).toContain("project=webappwiz");
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
					"## ⏸ Deferred locale-prices: waiting on webappwiz #404\n\nIt set out to show prices by locale.",
				),
			],
		});
		const view = await testing.openConversations([deferring], undefined, {
			todos: [
				todo({
					id: 20,
					subject: "Show prices by locale",
					blockedElsewhere: [LOCALE],
					deferred: {
						why: "Needs the locale change in webappwiz.",
						at: "2026-10-27T10:00:00.000Z",
						task: "locale-prices",
						tasks: [LOCALE],
						questions: [],
						outside: [],
					},
				}),
			],
			lanes: [],
			elsewhere: {
				blockers: { 20: [{ ...LOCALE, slug: "webappwiz", status: "working" }] },
				following: {},
			},
		});

		const card = await waitFor(() =>
			view.getByRole("region", { name: "deferred locale-prices" }),
		);
		within(card).getByTitle("#404 in webappwiz, another project");
		expect(card.textContent).toContain("being worked on");
		expect(within(card).queryByRole("button", { name: /#404/ })).toBeNull();

		fireEvent.click(
			within(card).getByRole("button", { name: "Resume anyway" }),
		);
		await waitFor(() =>
			expect(testing.posted("/api/todos/20/blocked-by")).toEqual([
				{ method: "PUT", body: { blockedBy: [], blockedElsewhere: [] } },
			]),
		);
	});
});
