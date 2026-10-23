import "./register-dom";
import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { MERGE_SHOWN, MERGE_SLOW, MERGE_STUCK, MergeTime } from "./merge-time";

afterEach(cleanup);

function ago(ms: number): string {
	return new Date(Date.now() - ms).toISOString();
}

describe("MergeTime", () => {
	it("shows nothing for an agent not merging", () => {
		const view = render(
			<MergeTime need={{ kind: "working", subject: null }} />,
		);
		expect(view.container.textContent).toBe("");
	});

	it("shows nothing in a merge's first three minutes, then whole minutes, muted, then amber, then red", () => {
		const shown = (since: string) =>
			render(
				<MergeTime
					need={{
						kind: "working",
						subject: null,
						merge: "queued",
						mergeSince: since,
					}}
				/>,
			).container.firstElementChild;
		expect(shown(ago(5_000))).toBeNull();
		expect(shown(ago(MERGE_SHOWN.ms - 1000))).toBeNull();
		const usual = shown(ago(MERGE_SHOWN.ms + 1000));
		expect(usual?.textContent).toBe("3m");
		expect(usual?.className).toContain("text-muted-foreground");
		expect(shown(ago(MERGE_SLOW.ms + 1000))?.className).toContain(
			"text-warning",
		);
		const stuck = shown(ago(MERGE_STUCK.ms + 1000));
		expect(stuck?.className).toContain("text-destructive");
		expect(stuck?.textContent).toBe(">10m");
	});
});
