import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	cleanup,
	conversation,
	message,
	Testing,
	waitFor,
	within,
} from "./testing";

describe("App's report card", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("renders a report as ordinary markdown", async () => {
		await testing.openConversations([
			conversation({
				title: "Health",
				messages: [
					message(
						"agent",
						[
							"## 📊 Report: test health",
							"",
							"One test fails.",
							"",
							"```stats",
							"Failing: 1 (+1 ❌)",
							"```",
							"",
							"> ❌ render.test.ts broke",
							"",
							"```chart bar: Failures",
							"| Package | Count |",
							"| --- | --- |",
							"| vexml | 12 |",
							"```",
							"",
							"### Details",
							"",
							"Logs.",
						].join("\n"),
					),
				],
			}),
		]);
		await waitFor(() =>
			expect(
				within(document.body).getByRole("heading", {
					name: "📊 Report: test health",
				}),
			).toBeTruthy(),
		);
		expect(
			within(document.body).queryByRole("region", {
				name: "report test health",
			}),
		).toBeNull();
		expect(within(document.body).getByText("One test fails.")).toBeTruthy();
		expect(within(document.body).getByText("Logs.")).toBeTruthy();
	});

	it("draws readouts in a Done card's body", async () => {
		await testing.openConversations([
			conversation({
				title: "Audit",
				messages: [
					message(
						"agent",
						[
							"## ✅ Done: audit finished",
							"",
							"All clear.",
							"",
							"```stats",
							"Failing: 0",
							"```",
						].join("\n"),
					),
				],
			}),
		]);
		await waitFor(() => {
			expect(within(document.body).getByText("Failing")).toBeTruthy();
		});
		expect(within(document.body).getByText("All clear.")).toBeTruthy();
	});
});
