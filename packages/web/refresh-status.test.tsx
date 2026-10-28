import { afterEach, describe, expect, it } from "bun:test";
import { type Freshness, FreshnessContext } from "./freshness";
import { cleanup, fireEvent, render, waitFor } from "./testing-library";
import { TopBar, TopBarFrame } from "./top-bar";

describe("Refresh feedback in the header", () => {
	afterEach(cleanup);

	it("stays in the header without taking focus or making the page inert", () => {
		const page = render(<Screen freshness={FRESH} />);
		const input = page.getByRole("textbox");
		input.focus();
		fireEvent.change(input, { target: { value: "Draft in progress" } });
		page.rerender(<Screen freshness={{ ...FRESH, stale: true }} />);
		const status = page.getByRole("status", { name: "Refreshing" });
		expect(status.closest("header")).not.toBeNull();
		expect(page.getByRole("textbox").closest("[inert]")).toBeNull();
		expect(document.activeElement).toBe(input);
		expect((input as HTMLInputElement).value).toBe("Draft in progress");
		page.rerender(<Screen freshness={FRESH} />);
		expect(page.queryByRole("status", { name: "Refreshing" })).toBeNull();
		expect(document.activeElement).toBe(input);
	});

	it("shows an update before the streams drop, without blocking the page", () => {
		const page = render(<Screen freshness={FRESH} updating />);
		expect(page.getByRole("status", { name: "Refreshing" }).textContent).toBe(
			"Updating the server…",
		);
		expect(page.getByRole("textbox").closest("[inert]")).toBeNull();
	});

	it("opens refresh details on tap and closes on Escape", async () => {
		const page = render(<Screen freshness={{ ...FRESH, stale: true }} />);
		fireEvent.click(page.getByRole("button", { name: "Refreshing" }));
		const details = await waitFor(() =>
			page.getByRole("dialog", { name: "Refreshing…" }),
		);
		expect(details.textContent).toContain(
			"fetching the latest conversations and tasks",
		);
		expect(page.getByRole("textbox").closest("[inert]")).toBeNull();
		fireEvent.keyDown(details, { key: "Escape" });
		await waitFor(() => expect(page.queryByRole("dialog")).toBeNull());
	});

	it("leaves unreachable feedback to the offline banner", () => {
		const page = render(
			<Screen freshness={{ ...FRESH, stale: true, unreachable: true }} />,
		);
		expect(page.queryByRole("status", { name: "Refreshing" })).toBeNull();
	});
});

const FRESH: Freshness = {
	stale: false,
	unreachable: false,
	reason: null,
	retry: () => {},
};

function Screen({
	freshness,
	updating = false,
}: {
	freshness: Freshness;
	updating?: boolean;
}) {
	return (
		<FreshnessContext value={freshness}>
			<TopBarFrame value={{ refreshing: updating }}>
				<TopBar title="Inbox" />
				<input aria-label="Draft" />
			</TopBarFrame>
		</FreshnessContext>
	);
}
