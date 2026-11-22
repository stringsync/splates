import { afterEach, describe, expect, it } from "bun:test";
import type { SignalWait } from "@splates/server/signals";
import { SignalSight, SignalWaits } from "./signal-contexts";
import { cleanup, render } from "./testing-library";
import { WaitBar } from "./wait-bar";

describe("wait bar", () => {
	afterEach(cleanup);

	it("shows the live wait that ends first, with the others counted", () => {
		const view = bar([
			wait({ id: "late", name: "late.one", hours: 5 }),
			wait({ id: "soon", name: "soon.one", hours: 1 }),
			wait({ id: "done", name: "done.one", hours: 0, state: "raised" }),
		]);
		expect(view.getByLabelText("View signal soon.one")).toBeTruthy();
		expect(view.queryByLabelText("View signal late.one")).toBeNull();
		expect(view.getByText("+1")).toBeTruthy();
	});

	it("keeps the bar visible while the wait's own line is in sight", () => {
		const view = bar(
			[wait({ id: "w1", name: "mdom.released", hours: 1 })],
			["w1"],
		);
		expect(view.getByLabelText("View signal mdom.released")).toBeTruthy();
	});

	it("keeps a long name on one line, its last part whole and the rest shrinking", () => {
		const view = bar([
			wait({ id: "w1", name: "sound2score.prod-fast", hours: 1 }),
		]);
		const leaf = view.getByText("prod-fast");
		expect(leaf.className).toContain("shrink-0");
		expect(view.getByText("sound2score.").className).toContain("truncate");
		expect(leaf.parentElement?.className).not.toContain("break-all");
		expect(leaf.parentElement?.title).toBe("signal sound2score.prod-fast");
	});
});

function bar(waits: SignalWait[], seen: string[] = []) {
	return render(
		<SignalWaits value={{ conversation: "c1", waits }}>
			<SignalSight value={{ inView: new Set(seen), sight: () => {} }}>
				<WaitBar />
			</SignalSight>
		</SignalWaits>,
	);
}

function wait(
	over: Partial<SignalWait> & { id: string; name: string; hours: number },
): SignalWait {
	const { hours, ...rest } = over;
	return {
		description: "",
		state: "waiting",
		startedAt: new Date(Date.now() - 60_000).toISOString(),
		deadline: new Date(Date.now() + hours * 3_600_000).toISOString(),
		since: null,
		...rest,
	} as SignalWait;
}
