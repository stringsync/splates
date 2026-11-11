import { afterEach, describe, expect, test } from "bun:test";
import { Live } from "./rec-live";
import { cleanup, fireEvent, render, waitFor, within } from "./testing-library";

const realFetch = globalThis.fetch;
const STATUS = { running: true, name: "brave-copper-otter" };

describe("Live", () => {
	afterEach(() => {
		cleanup();
		globalThis.fetch = realFetch;
	});

	test("Stop asks the server to close, then says it closed", async () => {
		const posted: string[] = [];
		globalThis.fetch = (async (url: string) => {
			posted.push(String(url));
			return new Response(null, { status: 204 });
		}) as unknown as typeof fetch;
		let closed = 0;
		const view = render(
			<Live status={STATUS} host="here" onClosed={() => closed++} />,
		);

		fireEvent.click(
			within(view.container).getByRole("button", { name: "Stop" }),
		);

		await waitFor(() => expect(closed).toBe(1));
		expect(posted).toEqual(["/api/rec/close"]);
	});

	test("a failed close shows why and leaves the button to try again", async () => {
		globalThis.fetch = (async () =>
			Response.json(
				{ reason: "no_rec", message: "no running rec was found to close" },
				{ status: 409 },
			)) as unknown as typeof fetch;
		let closed = 0;
		const view = render(
			<Live status={STATUS} host="here" onClosed={() => closed++} />,
		);

		fireEvent.click(
			within(view.container).getByRole("button", { name: "Stop" }),
		);

		await waitFor(() =>
			expect(within(view.container).getByText(/no running rec/)),
		);
		expect(closed).toBe(0);
		expect(
			within(view.container).getByRole("button", { name: "Stop" }),
		).toBeTruthy();
	});
});
