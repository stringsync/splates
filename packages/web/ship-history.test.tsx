import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { CascadeSummary } from "@splates/server/ship";
// Before the page: base-ui reads the DOM as it loads, so a file run alone
// needs it registered first.
import "./register-dom";
import { FakeStream, type Stream } from "./fake-stream";
import { ShipsPage } from "./ships-page";
import { act, cleanup, fireEvent, render } from "./testing-library";

describe("Ship history", () => {
	let stream: Stream | null = null;
	beforeEach(() => {
		location.hash = "ships";
		globalThis.EventSource = class extends FakeStream {
			constructor() {
				super();
				stream = this;
			}
		} as unknown as typeof EventSource;
		globalThis.fetch = (async (url: string) =>
			Response.json(
				String(url).startsWith("/api/ship/graph") ? { projects: [] } : past,
			)) as unknown as typeof fetch;
	});
	afterEach(() => {
		cleanup();
		location.hash = "";
		globalThis.fetch = realFetch;
		globalThis.EventSource = realEventSource;
	});
	const open = () => {
		const view = render(<ShipsPage />);
		act(() =>
			stream?.onmessage?.({
				data: JSON.stringify({ cascade: null, ship: null }),
			}),
		);
		return view;
	};

	it("keeps history off the plan, naming the last ship with a way to all of them", async () => {
		const view = open();
		const link = await view.findByRole("link", { name: "See all" });
		expect(view.getByText(/vexml v2\.1\.0/)).toBeTruthy();
		expect(link.getAttribute("href")).toBe("#ships/history");
		expect(view.queryByLabelText("history")).toBeNull();
	});

	it("lists every ship by week and narrows them with the filters", async () => {
		location.hash = "ships/history";
		const view = open();
		const list = await view.findByLabelText("history");
		expect(list.textContent).toContain("This week");
		expect(list.textContent).toContain("Earlier");
		expect(list.querySelectorAll("li")).toHaveLength(3);
		fireEvent.click(view.getByRole("button", { name: "Failed" }));
		expect(list.querySelectorAll("li")).toHaveLength(1);
		expect(list.textContent).toContain("publish workflow failed");
		fireEvent.click(view.getByRole("button", { name: "Shipped" }));
		expect(list.querySelectorAll("li")).toHaveLength(2);
	});
});

const ago = (days: number) =>
	new Date(Date.now() - days * 86_400_000).toISOString();

const summary = (
	id: string,
	status: CascadeSummary["status"],
	days: number,
	note: string | null = null,
): CascadeSummary => ({
	id,
	from: id,
	status,
	started: ago(days),
	ended: ago(days),
	projects: [{ slug: id, status, to: "2.1.0", note }],
});

const past = [
	summary("vexml", "done", 1),
	summary("splates", "stopped", 3, "publish workflow failed"),
	summary("mdom", "done", 20),
];

const realFetch = globalThis.fetch;

const realEventSource = globalThis.EventSource;
