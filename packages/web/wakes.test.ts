import "./register-dom";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { PULSE } from "@stringsync/splates-server/server/browser";
import { Duration } from "webappwiz/time";
import { FakeClock } from "webappwiz/time/testing";
import { Wakes } from "./wakes";

describe("Wakes", () => {
	let clock: FakeClock;
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
		clock = new FakeClock();
		wakes = new Wakes(clock);
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

	it("hears nothing once disposed", () => {
		wakes.dispose();

		window.dispatchEvent(new Event("online"));

		expect(woke).toBe(0);
	});
});
