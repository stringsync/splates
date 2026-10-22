import "./register-dom";
import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import {
	CatchingUp,
	type Freshness,
	FreshnessContext,
	StaleChip,
	StaleLine,
} from "./freshness";

describe("Saying the page may be stale", () => {
	afterEach(cleanup);

	it("CatchingUp says on a phone, once it has been stale a moment, that it is updating, with a line sweeping, and dims nothing", async () => {
		const page = shown(STALE);

		expect(page.queryByText("Updating…")).toBeNull();
		const said = await waitFor(() => page.getByRole("status"));
		expect(said.textContent).toBe("Updating…");
		expect(page.container.querySelector(".animate-sweep")).not.toBeNull();
		expect(page.container.querySelector(".inset-0")).toBeNull();
	});

	it("CatchingUp shows nothing while fresh", async () => {
		const page = shown({ stale: false, unreachable: false, locked: false });

		await new Promise((done) => setTimeout(done, 400));
		expect(page.container.textContent).toBe("");
	});

	it("CatchingUp says nothing once splates is unreachable, the bar's pill saying so", () => {
		const page = shown(UNREACHABLE);

		expect(page.container.textContent).toBe("");
	});

	it("StaleChip and StaleLine say in a desktop's bar, once it has been stale a moment, that it is updating, with a line sweeping under it", async () => {
		const page = barred(STALE);

		expect(page.queryByText("Updating…")).toBeNull();
		const said = await waitFor(() => page.getByRole("status"));
		expect(said.textContent).toBe("Updating…");
		expect(page.container.querySelector(".animate-sweep")).not.toBeNull();
	});

	it("StaleChip and StaleLine say nothing while fresh", async () => {
		const page = barred({ stale: false, unreachable: false, locked: false });

		await new Promise((done) => setTimeout(done, 400));
		expect(page.container.textContent).toBe("");
		expect(page.container.querySelector(".animate-sweep")).toBeNull();
	});

	it("StaleChip says at once that it is offline, with no buttons and no line", () => {
		const page = barred(UNREACHABLE);

		expect(page.getByRole("status").textContent).toBe("Offline");
		expect(page.queryByRole("button")).toBeNull();
		expect(page.container.querySelector("[aria-hidden].sticky")).toBeNull();
	});
});

const STALE: Freshness = {
	stale: true,
	unreachable: false,
	locked: true,
};

const UNREACHABLE: Freshness = {
	stale: true,
	unreachable: true,
	locked: false,
};

function shown(freshness: Freshness) {
	return render(
		<FreshnessContext value={freshness}>
			<CatchingUp />
		</FreshnessContext>,
	);
}

/** A desktop's bar: the chip beside its title and the line along its foot. */
function barred(freshness: Freshness) {
	return render(
		<FreshnessContext value={freshness}>
			<StaleChip />
			<StaleLine />
		</FreshnessContext>,
	);
}
