import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import "./register-dom";
import { RecHistory } from "./rec-history";
import { cleanup, render, waitFor } from "./testing-library";

const realFetch = globalThis.fetch;
const DAY = 24 * 60 * 60 * 1000;

describe("RecHistory", () => {
	beforeEach(() => {
		globalThis.fetch = (async () =>
			Response.json({
				sessions: [
					{
						name: "brave-otter",
						folder: "/x/a",
						startedAt: Date.now() - DAY,
						length: 75,
						size: 2_000_000,
						moments: 3,
						topSaid: "the save button does nothing",
					},
					{
						name: "old-fox",
						folder: "/x/b",
						startedAt: Date.now() - 30 * DAY,
						length: 10,
						size: 1_000_000,
						moments: 0,
					},
				],
				totalSize: 3_000_000,
				limit: 5_000_000_000,
				policy:
					"At 5 GB, rec deletes the oldest sessions first, whatever their name.",
			})) as unknown as typeof fetch;
	});
	afterEach(() => {
		cleanup();
		globalThis.fetch = realFetch;
	});

	it("groups sessions by age and discloses the deletion rule", async () => {
		const view = render(<RecHistory />);
		await waitFor(() => view.getByLabelText("brave-otter"));
		expect(view.getByText("This week")).toBeTruthy();
		expect(view.getByText("Earlier")).toBeTruthy();
		expect(view.getByText(/the save button does nothing/)).toBeTruthy();
		expect(
			view.getByText(/oldest sessions first, whatever their name/),
		).toBeTruthy();
		expect(
			view
				.getByLabelText("brave-otter")
				.querySelector("a")
				?.getAttribute("href"),
		).toBe("#rec/brave-otter");
	});
});
