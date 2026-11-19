import { afterEach, describe, expect, it } from "bun:test";
import type { SignalWait } from "@splates/server/signals";
import { SignalCard } from "./signal-card";
import { timeLeft } from "./signal-of";
import { cleanup, render } from "./testing-library";

const wait = (over: Partial<SignalWait> = {}): SignalWait => ({
	id: "w1",
	name: "mdom.released",
	description: "mdom's 2.4.0 on npm",
	state: "waiting",
	startedAt: new Date().toISOString(),
	deadline: new Date(Date.now() + 5 * 3_600_000).toISOString(),
	since: null,
	...over,
});

describe("signal card", () => {
	afterEach(cleanup);

	it("shows the state in its header, the description always, and Stop waiting while it waits", () => {
		const waiting = render(<SignalCard wait={wait()} conversation="c1" />);
		expect(waiting.getByText("Waiting on mdom.released")).toBeTruthy();
		expect(waiting.getByText("mdom's 2.4.0 on npm")).toBeTruthy();
		expect(waiting.getByRole("button", { name: "Stop waiting" })).toBeTruthy();
		cleanup();

		const raised = render(
			<SignalCard
				conversation="c1"
				wait={wait({
					state: "raised",
					raise: {
						at: new Date().toISOString(),
						by: "bump",
						payload: { v: 1 },
					},
				})}
			/>,
		);
		expect(raised.getByText("mdom.released raised")).toBeTruthy();
		expect(raised.getByText("mdom's 2.4.0 on npm")).toBeTruthy();
		expect(raised.getByText(/"v": 1/)).toBeTruthy();
		expect(raised.queryByRole("button", { name: "Stop waiting" })).toBeNull();
	});

	it("says it timed out and was stopped", () => {
		const timed = render(
			<SignalCard wait={wait({ state: "timed out" })} conversation="c1" />,
		);
		expect(timed.getByText("mdom.released timed out")).toBeTruthy();
		cleanup();
		const stopped = render(
			<SignalCard wait={wait({ state: "stopped" })} conversation="c1" />,
		);
		expect(stopped.getByText("Stopped waiting on mdom.released")).toBeTruthy();
	});

	it("reads the time left", () => {
		const now = Date.parse("2026-11-18T12:00:00Z");
		expect(timeLeft("2026-11-18T17:00:00Z", now)).toBe("5h");
		expect(timeLeft("2026-11-18T12:40:00Z", now)).toBe("40m");
		expect(timeLeft("2026-11-18T11:00:00Z", now)).toBe("under a minute");
		expect(timeLeft("2026-11-20T12:00:00Z", now)).toBe("2d");
	});
});
