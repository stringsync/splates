import "./register-dom";
import { afterEach, describe, expect, it } from "bun:test";
import type { RaiseOffer } from "@stringsync/splates-server/workers";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { RaiseOfferButton } from "./slot-queue";

const OFFER: RaiseOffer = {
	limit: "hour",
	dollars: 0.06,
	type: "small",
	platform: "linux",
	slots: 4,
	dollarsPerHour: 0.11,
	clears: 4,
};

describe("RaiseOfferButton", () => {
	const original = globalThis.fetch;
	afterEach(() => {
		cleanup();
		globalThis.fetch = original;
	});

	it("says nothing without an offer", () => {
		const { container } = render(<RaiseOfferButton offer={null} />);

		expect(container.textContent).toBe("");
	});

	it("prices the raise and what it clears, with the worker's specs under it", () => {
		const page = render(<RaiseOfferButton offer={OFFER} />);

		expect(page.container.textContent).toContain(
			"+$0.06/h starts 1 more worker, which clears 4 queued tasks",
		);
		expect(page.container.textContent).toContain(
			"A small on linux: 4 slots at $0.11/h.",
		);
	});

	it("asks once in place, then raises the limit for a day", async () => {
		const sent: { url: string; body: string }[] = [];
		globalThis.fetch = (async (url: string, init: RequestInit) => {
			sent.push({ url: String(url), body: String(init.body) });
			return Response.json({});
		}) as unknown as typeof fetch;
		const page = render(<RaiseOfferButton offer={OFFER} />);

		fireEvent.click(page.getByRole("button", { name: "Raise +$0.06/h" }));
		expect(sent).toEqual([]);
		fireEvent.click(page.getByRole("button", { name: "Raise for a day" }));

		await waitFor(() => expect(page.getByText("Raised")).toBeTruthy());
		expect(sent[0]?.url).toContain("/api/worker-budget/raises");
		expect(JSON.parse(sent[0]?.body ?? "")).toEqual({
			limit: "hour",
			dollars: 0.06,
			for: "1d",
		});
	});
});
