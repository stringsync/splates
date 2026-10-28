import { afterEach, describe, expect, it } from "bun:test";
import { Duration } from "webappwiz/time";
import { OFFLINE_AFTER } from "./feed";
import {
	type Freshness,
	FreshnessContext,
	REFRESH_WAITS,
	RefreshingOverlay,
} from "./freshness";
import { cleanup, render, waitFor } from "./testing-library";

describe("Covering the page while it refreshes", () => {
	const slow = REFRESH_WAITS.slow;

	const fade = REFRESH_WAITS.fade;

	afterEach(() => {
		REFRESH_WAITS.slow = slow;
		REFRESH_WAITS.fade = fade;
		cleanup();
	});

	it("shows the countdown after 10 seconds and gives up after 30", () => {
		expect(REFRESH_WAITS.slow.ms).toBe(10_000);
		expect(OFFLINE_AFTER.ms).toBe(30_000);
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

	it("fades out and gives the page back its input once fresh", async () => {
		REFRESH_WAITS.fade = Duration.ms(10);
		const page = covered(STALE);
		const status = page.getByRole("status", { name: "Refreshing" });
		page.rerender(
			<FreshnessContext value={FRESH}>
				<button type="button">Behind</button>
				<RefreshingOverlay />
			</FreshnessContext>,
		);

		expect(status.closest(".fixed")?.className).toContain(
			"motion-safe:fade-out",
		);
		expect(status.closest(".fixed")?.getAttribute("aria-hidden")).toBe("true");
		expect(page.queryByRole("status", { name: "Refreshing" })).toBeNull();
		expect(
			page.getByRole("button", { name: "Behind" }).closest("[inert]"),
		).toBeNull();
		await waitFor(() =>
			expect(page.queryByRole("status", { name: "Refreshing" })).toBeNull(),
		);
	});

	it("shows only a short timeout below the label once the refresh runs on", async () => {
		REFRESH_WAITS.slow = Duration.ms(10);
		const page = covered({
			...STALE,
			givesUpAt: Date.now() + 2_000,
			waitsMs: 10_000,
		});

		const countdown = await waitFor(() => page.getByText("Timeout in 2s"));
		const status = page.getByRole("status", { name: "Refreshing" });
		expect(status.nextElementSibling?.contains(countdown)).toBe(true);
		expect(status.contains(countdown)).toBe(false);
		expect(page.queryByRole("button", { name: "Retry" })).toBeNull();
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
