import { afterEach, describe, expect, it } from "bun:test";
import {
	type Freshness,
	FreshnessContext,
	OfflineBanner,
	StaleRows,
} from "./freshness";
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

	it("locks the inbox rows, with no dimming, words, line or spinner", async () => {
		const page = rows(STALE);

		const row = page.getByText("A row");
		expect(row.closest("[inert]")).not.toBeNull();
		await new Promise((done) => setTimeout(done, 400));
		expect(page.container.innerHTML).not.toContain("opacity");
		expect(page.queryByRole("status")).toBeNull();
		expect(page.container.textContent).toBe("A row");
	});

	it("does not lock the inbox rows while fresh", async () => {
		const page = rows({ ...STALE, stale: false, locked: false });

		await new Promise((done) => setTimeout(done, 400));
		expect(page.container.querySelector("[inert]")).toBeNull();
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
	locked: false,
	givesUpAt: null,
	waitsMs: 10_000,
	retry: () => {},
};

const STALE: Freshness = { ...FRESH, stale: true, locked: true };

const UNREACHABLE: Freshness = { ...FRESH, stale: true, unreachable: true };

function rows(freshness: Freshness) {
	return render(
		<FreshnessContext value={freshness}>
			<StaleRows>
				<div>A row</div>
			</StaleRows>
		</FreshnessContext>,
	);
}

function barred(freshness: Freshness) {
	return render(
		<FreshnessContext value={freshness}>
			{freshness.unreachable && <OfflineBanner reason={freshness.reason} />}
		</FreshnessContext>,
	);
}
