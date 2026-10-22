import "./register-dom";
import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { CatchingUp, type Freshness, FreshnessContext } from "./freshness";

afterEach(cleanup);

const STALE: Freshness = {
	stale: true,
	unreachable: false,
	locked: true,
	retry: () => {},
	dismiss: () => {},
};

function shown(freshness: Freshness, wide = false) {
	return render(
		<FreshnessContext value={freshness}>
			<CatchingUp wide={wide} />
		</FreshnessContext>,
	);
}

describe("CatchingUp", () => {
	it("dims a phone's whole screen only once it has been stale a moment, saying it is catching up", async () => {
		const page = shown(STALE);

		expect(page.queryByText("Catching up…")).toBeNull();
		const said = await waitFor(() => page.getByRole("status"));
		expect(said.textContent).toContain("Catching up…");
		expect(said.parentElement?.className).toContain("fixed inset-0");
	});

	it("on a desktop, greys the page below the bar and says so in a toast at the foot", async () => {
		const page = shown(STALE, true);

		const said = await waitFor(() => page.getByRole("status"));
		expect(said.parentElement?.className).toContain("bottom-6");
		expect(
			page.container.querySelector(".top-\\(--top-bar-height\\)"),
		).not.toBeNull();
	});

	it("shows nothing while fresh", async () => {
		const page = shown({ ...STALE, stale: false, locked: false });

		await new Promise((done) => setTimeout(done, 400));
		expect(page.container.textContent).toBe("");
	});

	it("says at once that splates is unreachable, with a Retry and a dismiss", () => {
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

	it("once dismissed, leaves only a pill with Retry over the page", () => {
		const page = shown({ ...STALE, unreachable: true, locked: false }, true);

		const said = page.getByRole("alert");
		page.getByRole("button", { name: "Retry" });
		expect(page.queryByRole("button", { name: "Dismiss" })).toBeNull();
		expect(said.parentElement?.className).not.toContain("inset");
		expect(
			page.container.querySelector(".top-\\(--top-bar-height\\)"),
		).toBeNull();
	});
});
