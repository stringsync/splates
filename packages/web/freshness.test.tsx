import "./register-dom";
import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import {
	type Freshness,
	FreshnessContext,
	StaleChip,
	StaleRows,
} from "./freshness";

describe("Saying the page may be stale", () => {
	afterEach(cleanup);

	it("locks the inbox rows at once and only dims them, once it has been stale a moment, with no words, line or spinner", async () => {
		const page = rows(STALE);

		const row = page.getByText("A row");
		expect(row.closest("[inert]")).not.toBeNull();
		expect(row.className).not.toContain("opacity");
		await waitFor(() =>
			expect(page.container.firstElementChild?.className).toContain(
				"*:opacity-60",
			),
		);
		expect(page.queryByRole("status")).toBeNull();
		expect(page.container.textContent).toBe("A row");
	});

	it("neither locks nor dims the inbox rows while fresh", async () => {
		const page = rows({
			stale: false,
			unreachable: false,
			locked: false,
			givesUpAt: null,
			waitsMs: 10_000,
		});

		await new Promise((done) => setTimeout(done, 400));
		expect(page.container.querySelector("[inert]")).toBeNull();
		expect(page.container.firstElementChild?.className).not.toContain(
			"*:opacity-60",
		);
	});

	it("says nothing in the bar while the page only catches up", async () => {
		const page = barred(STALE);

		await new Promise((done) => setTimeout(done, 400));
		expect(page.container.textContent).toBe("");
	});

	it("counts down in the bar once a wait has run on", () => {
		const page = barred({ ...STALE, givesUpAt: Date.now() + 4_000 });

		expect(page.getByRole("status").textContent).toBe(
			"Still loading, gives up in 4s",
		);
	});

	it("says at once in the bar, as an error, that it cannot reach the server, with no buttons", () => {
		const page = barred(UNREACHABLE);

		expect(page.getByRole("alert").textContent).toBe("Can't reach the server");
		expect(page.queryByRole("button")).toBeNull();
		expect(page.queryByRole("status")).toBeNull();
	});
});

const STALE: Freshness = {
	stale: true,
	unreachable: false,
	locked: true,
	// Just gone stale: the countdown is a while off.
	givesUpAt: Date.now() + 10_000,
	waitsMs: 10_000,
};

const UNREACHABLE: Freshness = {
	stale: true,
	unreachable: true,
	locked: false,
	givesUpAt: null,
	waitsMs: 10_000,
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
