import { afterEach, describe, expect, it } from "bun:test";
import {
	type Freshness,
	FreshnessContext,
	StaleChip,
	StaleRows,
} from "./freshness";
import { cleanup, render } from "./testing-library";

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
		const page = rows({
			stale: false,
			unreachable: false,
			reason: null,
			locked: false,
		});

		await new Promise((done) => setTimeout(done, 400));
		expect(page.container.querySelector("[inert]")).toBeNull();
	});

	it("says nothing in the bar while the page only catches up", async () => {
		const page = barred(STALE);

		await new Promise((done) => setTimeout(done, 400));
		expect(page.container.textContent).toBe("");
	});

	it("says at once in the bar, as an error, that it cannot reach the server, with no buttons", () => {
		const page = barred(UNREACHABLE);

		expect(page.getByRole("alert").textContent).toBe("Offline");
		expect(page.queryByRole("button")).toBeNull();
		expect(page.queryByRole("status")).toBeNull();
	});
});

const STALE: Freshness = {
	stale: true,
	unreachable: false,
	reason: null,
	locked: true,
};

const UNREACHABLE: Freshness = {
	stale: true,
	unreachable: true,
	reason: null,
	locked: false,
};

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
