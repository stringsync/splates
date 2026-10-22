import "./register-dom";
import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import {
	CatchingUp,
	type Freshness,
	FreshnessContext,
	StaleChip,
	StaleLine,
} from "./freshness";

describe("Saying the page may be stale", () => {
	afterEach(cleanup);

	it("CatchingUp dims a phone's whole screen only once it has been stale a moment, saying it is catching up", async () => {
		const page = shown(STALE);

		expect(page.queryByText("Catching up…")).toBeNull();
		const said = await waitFor(() => page.getByRole("status"));
		expect(said.textContent).toContain("Catching up…");
		expect(said.parentElement?.className).toContain("fixed inset-0");
	});

	it("CatchingUp shows nothing while fresh", async () => {
		const page = shown({ ...STALE, stale: false, locked: false });

		await new Promise((done) => setTimeout(done, 400));
		expect(page.container.textContent).toBe("");
	});

	it("CatchingUp says at once that splates is unreachable, with a Retry and a dismiss", () => {
		const pressed: string[] = [];
		const page = shown({
			...STALE,
			unreachable: true,
			retry: () => pressed.push("retry"),
			dismiss: () => pressed.push("dismiss"),
		});

		const said = page.getByRole("alert");
		expect(said.textContent).toContain("Can't reach splates.");
		fireEvent.click(page.getByRole("button", { name: "Retry" }));
		fireEvent.click(page.getByRole("button", { name: "Dismiss" }));
		expect(pressed).toEqual(["retry", "dismiss"]);
	});

	it("CatchingUp, once dismissed, leaves only a pill with Retry over the page", () => {
		const page = shown({ ...STALE, unreachable: true, locked: false });

		const said = page.getByRole("alert");
		page.getByRole("button", { name: "Retry" });
		expect(page.queryByRole("button", { name: "Dismiss" })).toBeNull();
		expect(said.parentElement?.className).not.toContain("inset-0");
	});

	it("StaleChip and StaleLine say in a desktop's bar once it has been stale a moment that it is catching up, with a line sweeping under it", async () => {
		const page = barred(STALE);

		expect(page.queryByText("Catching up…")).toBeNull();
		const said = await waitFor(() => page.getByRole("status"));
		expect(said.textContent).toContain("Catching up…");
		expect(page.container.querySelector(".animate-sweep")).not.toBeNull();
	});

	it("StaleChip and StaleLine say nothing while fresh", async () => {
		const page = barred({ ...STALE, stale: false, locked: false });

		await new Promise((done) => setTimeout(done, 400));
		expect(page.container.textContent).toBe("");
		expect(page.container.querySelector(".animate-sweep")).toBeNull();
	});

	it("StaleChip and StaleLine say at once that splates is unreachable, with a Retry and a dismiss, the line still", () => {
		const pressed: string[] = [];
		const page = barred({
			...STALE,
			unreachable: true,
			retry: () => pressed.push("retry"),
			dismiss: () => pressed.push("dismiss"),
		});

		expect(page.getByRole("alert").textContent).toContain(
			"Can't reach splates",
		);
		expect(page.container.querySelector(".animate-sweep")).toBeNull();
		expect(page.container.querySelector(".bg-amber-500\\/70")).not.toBeNull();
		fireEvent.click(page.getByRole("button", { name: "Retry" }));
		fireEvent.click(page.getByRole("button", { name: "Dismiss" }));
		expect(pressed).toEqual(["retry", "dismiss"]);
	});

	it("StaleChip and StaleLine, once dismissed, keep only the chip with Retry", () => {
		const page = barred({ ...STALE, unreachable: true, locked: false });

		page.getByRole("alert");
		page.getByRole("button", { name: "Retry" });
		expect(page.queryByRole("button", { name: "Dismiss" })).toBeNull();
		expect(page.container.querySelector("[aria-hidden].sticky")).toBeNull();
	});
});

const STALE: Freshness = {
	stale: true,
	unreachable: false,
	locked: true,
	retry: () => {},
	dismiss: () => {},
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
