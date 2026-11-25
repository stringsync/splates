import "./testing-dom";
import { afterEach, expect, it } from "bun:test";
import { JudgeBox } from "./eval-judgment";
import { cleanup, render } from "./testing";

afterEach(cleanup);

it("shows the judge's verdict as a card toned by how it went", () => {
	const view = render(
		<>
			<JudgeBox tone="pass" title="Judged · 4 of 4 checks passed" meta="$0.10">
				<p>checks</p>
			</JudgeBox>
			<JudgeBox tone="fail" title="Judged · 1 of 4 checks failed">
				<p>checks</p>
			</JudgeBox>
		</>,
	);
	const passed = view.getByRole("region", {
		name: "Judged · 4 of 4 checks passed",
	});
	expect(passed.hasAttribute("data-card")).toBe(true);
	expect(passed.textContent).toContain("$0.10");
	expect(
		view.getByRole("region", { name: "Judged · 1 of 4 checks failed" }),
	).toBeTruthy();
});
