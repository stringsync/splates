import { afterEach, describe, expect, it } from "bun:test";
import {
	type Freshness,
	FreshnessContext,
	StaleChip,
	StaleRows,
} from "./freshness";
import { cleanup, fireEvent, render } from "./testing-library";

describe("Saying the page may be stale", () => {
	afterEach(cleanup);

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

	it("says at once in the bar, as an error, that it cannot reach the server, with Retry beside it", () => {
		let retried = 0;
		const page = barred({ ...UNREACHABLE, retry: () => retried++ });

		expect(page.getByRole("alert").textContent).toBe("Offline");
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

/** A desktop's bar: the chip beside its title. */
function barred(freshness: Freshness) {
	return render(
		<FreshnessContext value={freshness}>
			<StaleChip />
		</FreshnessContext>,
	);
}
