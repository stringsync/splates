import "./register-dom";
import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { CatchingUp, type Freshness, FreshnessContext } from "./freshness";

afterEach(cleanup);

function shown(freshness: Freshness) {
	return render(
		<FreshnessContext value={freshness}>
			<CatchingUp />
		</FreshnessContext>,
	);
}

describe("CatchingUp", () => {
	it("dims the page only once it has been stale a moment, saying it is catching up", async () => {
		const page = shown({ stale: true, unreachable: false, retry: () => {} });

		expect(page.queryByText("Catching up…")).toBeNull();
		const said = await waitFor(() => page.getByRole("status"));
		expect(said.textContent).toContain("Catching up…");
		expect(said.parentElement?.className).toContain("fixed inset-0");
	});

	it("shows nothing while fresh", async () => {
		const page = shown({ stale: false, unreachable: false, retry: () => {} });

		await new Promise((done) => setTimeout(done, 400));
		expect(page.container.textContent).toBe("");
	});

	it("says at once that splates is unreachable, with a Retry", () => {
		let retried = 0;
		const page = shown({
			stale: true,
			unreachable: true,
			retry: () => retried++,
		});

		const said = page.getByRole("alert");
		expect(said.textContent).toContain("Can't reach splates.");
		fireEvent.click(page.getByRole("button", { name: "Retry" }));
		expect(retried).toBe(1);
	});
});
