import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { RecKeys } from "./rec-keys";
import { cleanup, render, waitFor, within } from "./testing-library";

const realFetch = globalThis.fetch;

describe("RecKeys", () => {
	beforeEach(() => {
		const kept = [
			{
				name: "OPENAI_API_KEY",
				scope: "device",
				provider: "system",
				savedBy: null,
			},
		];
		globalThis.fetch = (async () =>
			Response.json({
				kept,
				providers: [],
				labels: {},
			})) as unknown as typeof fetch;
	});
	afterEach(() => {
		cleanup();
		globalThis.fetch = realFetch;
	});

	test("shows only the key not yet saved on this device", async () => {
		const view = render(<RecKeys />);
		await waitFor(() =>
			expect(within(view.container).getByText("Smarter moment ranking")),
		);
		expect(
			within(view.container).queryByText("Timestamped dictation"),
		).toBeNull();
	});
});
