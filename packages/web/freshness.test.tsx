import { afterEach, describe, expect, it } from "bun:test";
import { type Freshness, FreshnessContext, OfflineBanner } from "./freshness";
import { cleanup, fireEvent, render } from "./testing-library";

describe("Saying the page may be stale", () => {
	afterEach(cleanup);

	it("shows disconnected immediately and disables retry without a connection", () => {
		const online = navigator.onLine;
		Object.defineProperty(navigator, "onLine", {
			configurable: true,
			value: false,
		});
		try {
			const page = barred(UNREACHABLE);
			expect(page.getByRole("alert").textContent).toContain("Disconnected.");
			expect(page.getByRole("alert").textContent).toContain(
				"No internet connection.",
			);
			expect(
				(page.getByRole("button", { name: "Retry" }) as HTMLButtonElement)
					.disabled,
			).toBe(true);
		} finally {
			Object.defineProperty(navigator, "onLine", {
				configurable: true,
				value: online,
			});
		}
	});

	it("says nothing in the bar while the page only catches up", async () => {
		const page = barred(STALE);

		await new Promise((done) => setTimeout(done, 400));
		expect(page.container.textContent).toBe("");
	});

	it("says at once below the bar that the server is unreachable, with Retry in the banner", () => {
		let retried = 0;
		const page = barred({ ...UNREACHABLE, retry: () => retried++ });

		expect(page.getByRole("alert").textContent).toContain("Offline.");
		expect(page.getByRole("alert").textContent).toContain(
			"What you see may be out of date.",
		);
		expect(page.queryByRole("status")).toBeNull();
		fireEvent.click(page.getByRole("button", { name: "Retry" }));
		expect(retried).toBe(1);
		expect(
			(page.getByRole("button", { name: "Retrying…" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
	});
});

const FRESH: Freshness = {
	stale: false,
	unreachable: false,
	reason: null,
	retry: () => {},
};

const STALE: Freshness = { ...FRESH, stale: true };

const UNREACHABLE: Freshness = { ...FRESH, stale: true, unreachable: true };

function barred(freshness: Freshness) {
	return render(
		<FreshnessContext value={freshness}>
			{freshness.unreachable && <OfflineBanner reason={freshness.reason} />}
		</FreshnessContext>,
	);
}
