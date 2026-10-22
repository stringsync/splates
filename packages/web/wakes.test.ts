import "./register-dom";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { PULSE } from "@stringsync/splates-server/server/browser";
import { Duration } from "webappwiz/time";
import { FakeTimer, FakeWallClock } from "webappwiz/time/testing";
import { Wakes } from "./wakes";

describe("Wakes", () => {
	let clock: FakeWallClock;
	let timer: FakeTimer;
	let wakes: Wakes;
	let woke: number;
	let shown: DocumentVisibilityState;

	const show = (state: DocumentVisibilityState) => {
		shown = state;
		document.dispatchEvent(new Event("visibilitychange"));
	};

	beforeEach(() => {
		shown = "visible";
		Object.defineProperty(document, "visibilityState", {
			configurable: true,
			get: () => shown,
		});
		clock = new FakeWallClock();
		timer = new FakeTimer();
		wakes = new Wakes(clock, timer);
		woke = 0;
		wakes.events.on("woke", () => woke++);
	});

	afterEach(() => {
		wakes.dispose();
		Reflect.deleteProperty(document, "visibilityState");
	});

	it("wakes when the page is shown again after a pulse or more hidden", () => {
		show("hidden");
		clock.advance(PULSE);
		show("visible");

		expect(woke).toBe(1);
	});

	it("says nothing of a quick look at another tab", () => {
		show("hidden");
		clock.advance(PULSE.subtract(Duration.secs(1)));
		show("visible");

		expect(woke).toBe(0);
	});

	it("wakes when the network comes back", () => {
		window.dispatchEvent(new Event("online"));

		expect(woke).toBe(1);
	});

	it("wakes when a tick comes a pulse late, as after a sleep the page spent shown", () => {
		clock.advance(Duration.secs(5).add(PULSE));
		timer.fireIntervals();

		expect(woke).toBe(1);
	});

	it("says nothing of ticks that come on time", () => {
		clock.advance(Duration.secs(5));
		timer.fireIntervals();
		clock.advance(Duration.secs(5));
		timer.fireIntervals();

		expect(woke).toBe(0);
	});

	it("leaves a hidden page's late ticks to its showing again", () => {
		show("hidden");
		clock.advance(Duration.secs(5).add(PULSE));
		timer.fireIntervals();

		expect(woke).toBe(0);
	});

	it("hears nothing once disposed", () => {
		wakes.dispose();

		window.dispatchEvent(new Event("online"));

		expect(woke).toBe(0);
	});
});
