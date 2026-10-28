import { afterEach, describe, expect, it } from "bun:test";
import { Duration } from "webappwiz/time";
import {
	type Freshness,
	FreshnessContext,
	REFRESH_WAITS,
	RefreshingOverlay,
} from "./freshness";
import { act, cleanup, fireEvent, render, waitFor } from "./testing-library";

describe("Covering the page while it refreshes", () => {
	const slow = REFRESH_WAITS.slow;

	afterEach(() => {
		REFRESH_WAITS.slow = slow;
		cleanup();
	});

	it("says only that it is refreshing, and takes no input on the rest of the page", () => {
		const page = covered(STALE);

		const status = page.getByRole("status", { name: "Refreshing" });
		expect(status.textContent).toBe("Refreshing…");
		expect(status.closest(".fixed")?.classList.contains("touch-none")).toBe(
			true,
		);
		expect(
			page.getByRole("button", { name: "Behind" }).closest("[inert]"),
		).not.toBeNull();
		expect(page.queryByRole("button", { name: "Retry" })).toBeNull();
	});

	it("gives the page back its input once fresh", () => {
		const page = covered(STALE);
		page.rerender(
			<FreshnessContext value={FRESH}>
				<button type="button">Behind</button>
				<RefreshingOverlay />
			</FreshnessContext>,
		);

		expect(page.queryByRole("status", { name: "Refreshing" })).toBeNull();
		expect(
			page.getByRole("button", { name: "Behind" }).closest("[inert]"),
		).toBeNull();
	});

	it("counts down to giving up and offers Retry once the refresh runs on", async () => {
		REFRESH_WAITS.slow = Duration.ms(10);
		let retried = 0;
		const page = covered({
			...STALE,
			givesUpAt: Date.now() + 2_000,
			waitsMs: 10_000,
			retry: () => retried++,
		});

		const button = await waitFor(() =>
			page.getByRole("button", { name: "Retry" }),
		);
		expect(page.getByText(/Still refreshing, gives up in 2s/)).toBeDefined();
		await act(async () => fireEvent.click(button));
		expect(retried).toBe(1);
	});
});

const FRESH: Freshness = {
	stale: false,
	unreachable: false,
	reason: null,
	locked: false,
	givesUpAt: null,
	waitsMs: 10_000,
	retry: () => {},
};

const STALE: Freshness = { ...FRESH, stale: true, locked: true };

/** The overlay over a page with a control behind it. */
function covered(freshness: Freshness) {
	return render(
		<FreshnessContext value={freshness}>
			<button type="button">Behind</button>
			<RefreshingOverlay />
		</FreshnessContext>,
	);
}
