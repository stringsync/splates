import { afterEach, describe, expect, it, setSystemTime } from "bun:test";
import type { SignalProbe, SignalWait } from "@splates/server/signals";
import { polls, SignalCard } from "./signal-card";
import {
	countdown,
	errored,
	errorsInARow,
	lasted,
	overlaps,
	probeFor,
	timeLeft,
} from "./signal-of";
import { cleanup, render } from "./testing-library";

describe("signal card", () => {
	afterEach(() => {
		cleanup();
		setSystemTime();
	});

	it("is an event line with the signal's chip, the time left and no stop", () => {
		const view = render(<SignalCard wait={wait()} />);
		const link = view.getByRole("link", { name: "mdom.released" });
		expect(link.getAttribute("href")).toBe("#signals/mdom.released");
		expect(view.getByRole("note", { name: "splates" })).toBeTruthy();
		expect(view.getByText(/^0[45]:\d\d:\d\d left$/)).toBeTruthy();
		expect(view.queryByRole("button", { name: "Stop waiting" })).toBeNull();
		expect(view.getByText("Waiting for")).toBeTruthy();
	});

	it("counts down to the earlier of a clock firing and the wait timeout", () => {
		const name =
			'clock.at({ time: "2026-11-27T14:00:00.000Z", tz: "America/New_York" })';
		const next = "2026-11-27T14:00:00.000Z";
		setSystemTime(new Date("2026-11-27T12:00:00.000Z"));
		const clock = {
			name,
			next,
			tz: "America/New_York",
			meaning: "Once at the scheduled time",
			startedAt: "2026-11-27T12:00:00.000Z",
			recurring: false,
		};
		const view = render(<SignalCard wait={wait({ name, clock })} />);
		expect(view.getByText("02:00:00 left")).toBeTruthy();
		expect(
			view.getByRole("link", { name: "clock.at" }).getAttribute("href"),
		).toBe(`#signals/${encodeURIComponent(name)}`);
		expect(view.getByText(/9:00 AM EST/).closest("time")?.dateTime).toBe(next);
		view.rerender(
			<SignalCard
				wait={wait({ name, clock, deadline: "2026-11-27T13:00:00.000Z" })}
			/>,
		);
		expect(view.getByText("01:00:00 until timeout")).toBeTruthy();
	});

	it("counts how many times its probe has polled beside the time left", () => {
		const view = render(<SignalCard wait={wait()} probe={probe()} />);
		expect(view.getByText(/^2 polls · 0[45]:\d\d:\d\d left$/)).toBeTruthy();
		expect(view.queryByText("E404 not found")).toBeNull();
	});

	it("is marked failed when its probe's checks error", () => {
		const view = render(
			<SignalCard
				wait={wait()}
				probe={probe({
					runs: [{ at: new Date().toISOString(), exit: 127, output: "" }],
				})}
			/>,
		);
		expect(view.getByText("Check failing for")).toBeTruthy();
		expect(view.getByLabelText("Failed")).toBeTruthy();
	});

	it("says how it ended and after how long, with no stop", () => {
		const fired = render(
			<SignalCard
				wait={wait({
					state: "raised",
					startedAt: new Date(Date.now() - 14 * 60_000).toISOString(),
					raise: { at: new Date().toISOString(), by: "bump", payload: null },
				})}
			/>,
		);
		expect(fired.getByText("fired after 14m")).toBeTruthy();
		expect(fired.queryByRole("button", { name: "Stop waiting" })).toBeNull();
		cleanup();
		const timed = render(
			<SignalCard
				wait={wait({
					state: "timed out",
					startedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
					endedAt: new Date().toISOString(),
				})}
			/>,
		);
		expect(timed.getByText("timed out after 2h")).toBeTruthy();
		cleanup();
		const stopped = render(<SignalCard wait={wait({ state: "stopped" })} />);
		expect(stopped.getByText("stopped")).toBeTruthy();
		cleanup();
		const removed = render(
			<SignalCard
				wait={wait({ state: "removed", reason: "probe replaced" })}
			/>,
		);
		expect(removed.getByText("signal removed").closest("p")?.title).toBe(
			"probe replaced",
		);
	});

	it("counts the polls a probe has made, until it stops", () => {
		expect(polls(probe({ count: 1932 }))).toBe(1932);
		expect(polls(probe({ state: "stopped", count: 5 }))).toBeNull();
	});

	it("reads the time left and how long it took", () => {
		const now = Date.parse("2026-11-18T12:00:00Z");
		expect(timeLeft("2026-11-18T17:00:00Z", now)).toBe("5h");
		expect(countdown("2026-11-20T15:12:09Z", now)).toBe("2d 03:12:09");
		expect(countdown("2026-11-18T13:05:07Z", now)).toBe("01:05:07");
		expect(countdown("2026-11-18T11:00:00Z", now)).toBe("00:00:00");
		expect(timeLeft("2026-11-18T12:40:00Z", now)).toBe("40m");
		expect(timeLeft("2026-11-18T13:52:00Z", now)).toBe("1h 52m");
		expect(timeLeft("2026-11-18T11:00:00Z", now)).toBe("under a minute");
		expect(timeLeft("2026-11-20T12:00:00Z", now)).toBe("2d");
		expect(lasted("2026-11-18T12:00:00Z", "2026-11-18T12:14:00Z")).toBe("14m");
		expect(lasted("2026-11-18T12:00:00Z", "2026-11-18T12:00:40Z")).toBe("40s");
	});

	it("takes exit 1 as not yet and any other failing exit as an error", () => {
		expect(errored({ exit: 0 })).toBe(false);
		expect(errored({ exit: 1 })).toBe(false);
		expect(errored({ exit: 2 })).toBe(true);
		expect(errored({ exit: 127 })).toBe(true);
		expect(
			errorsInARow([{ exit: 2 }, { exit: 1 }, { exit: 127 }, { exit: 2 }]),
		).toBe(2);
		expect(errorsInARow([{ exit: 1 }])).toBe(0);
	});

	it("pairs a wait with the latest probe on its signal while both were on", () => {
		const at = (minutes: number): string =>
			new Date(
				Date.parse("2026-11-18T12:00:00Z") + minutes * 60_000,
			).toISOString();
		const waiting = { name: "a.b", startedAt: at(10) };
		const old = { name: "a.b", startedAt: at(0), endedAt: at(5) };
		const replaced = { name: "a.b", startedAt: at(1), endedAt: at(12) };
		const current = { name: "a.b", startedAt: at(12) };
		const other = { name: "a.c", startedAt: at(9) };
		expect(overlaps(old, waiting)).toBe(false);
		expect(overlaps(replaced, waiting)).toBe(true);
		expect(overlaps(other, waiting)).toBe(false);
		expect(probeFor(waiting, [old, replaced, current, other])).toBe(current);
		expect(probeFor(waiting, [old, other])).toBeNull();
	});
});

function wait(over: Partial<SignalWait> = {}): SignalWait {
	return {
		id: "w1",
		name: "mdom.released",
		description: "mdom's 2.4.0 on npm",
		state: "waiting",
		startedAt: new Date(Date.now() - 60_000).toISOString(),
		deadline: new Date(Date.now() + 5 * 3_600_000).toISOString(),
		since: null,
		...over,
	};
}

function probe(over: Partial<SignalProbe> = {}): SignalProbe {
	return {
		name: "mdom.released",
		description: "mdom's 2.4.0 on npm",
		script: "npm view @stringsync/mdom@2.4.0 version",
		everyMs: 60_000,
		cwd: "/repo",
		conversation: "c1",
		state: "running",
		startedAt: new Date(Date.now() - 120_000).toISOString(),
		deadline: new Date(Date.now() + 5 * 3_600_000).toISOString(),
		passed: false,
		subscribed: true,
		count: 2,
		runs: [
			{ at: new Date(Date.now() - 60_000).toISOString(), exit: 1, output: "" },
			{ at: new Date().toISOString(), exit: 1, output: "E404 not found" },
		],
		next: new Date(Date.now() + 60_000).toISOString(),
		...over,
	};
}
