import { afterEach, describe, expect, test } from "bun:test";
import type { RunState } from "@splates/server/ship";
import { ShipRunList } from "./ship-past-runs";
import { cleanup, render } from "./testing-library";

describe("ShipRunList", () => {
	afterEach(cleanup);

	test("a run waiting on the user says which step", async () => {
		const waiting: RunState = {
			id: "r1",
			started: 1_000,
			status: "running",
			notes: [],
			targets: [
				{
					name: "@stringsync/mdom",
					command: "bin/mdom ship",
					dependencies: [],
					steps: [
						{
							id: "publish",
							does: "Publish to npm",
							dependencies: [],
							status: "waiting",
							output: [],
							prompts: [
								{
									id: "p1",
									at: 2_000,
									prompt: { kind: "confirm", question: "Go?" },
								},
							],
						},
					],
				},
			],
		};
		const view = render(<ShipRunList runs={[waiting]} />);
		expect(
			await view.findByText(/Waiting on you: Publish to npm/),
		).toBeTruthy();
	});
});
