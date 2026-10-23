import "./register-dom";
import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { MERGE_SLOW, MERGE_STUCK, MergeTime } from "./merge-time";

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

	it("counts from when the merge was asked for, muted, then amber, then red", () => {
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
		const fresh = shown(ago(5_000));
		expect(fresh?.textContent).toBe("5s");
		expect(fresh?.className).toContain("text-muted-foreground");
		expect(shown(ago(MERGE_SLOW.ms + 1000))?.className).toContain(
			"text-warning",
		);
		expect(shown(ago(MERGE_STUCK.ms + 1000))?.className).toContain(
			"text-destructive",
		);
	});
});
