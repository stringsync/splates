import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Duration } from "webappwiz/time";
import { FakeClock, FakeTimer } from "webappwiz/time/testing";
import { AutoRestart } from "./auto-restart";
import { listProjects, restartIdle } from "./project-api";
import { Settings } from "./settings";
import {
	act,
	cleanup,
	fireEvent,
	menuItem,
	Testing,
	waitFor,
	within,
} from "./testing";

describe("App's auto update", () => {
	let testing: Testing;
	let timer: FakeTimer;
	let clock: FakeClock;

	beforeEach(async () => {
		localStorage.clear();
		await new Settings(localStorage).set("restart.auto", true);
		testing = new Testing();
		timer = new FakeTimer();
		clock = new FakeClock();
		testing.autoRestart = new AutoRestart(
			{ list: listProjects, restart: restartIdle },
			new Settings(localStorage),
			{ timer, clock, input: window },
		);
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	/** Opens the page with `arbor dev` behind a commit on its source. */
	const open = () =>
		testing.open({
			behind: { running: "a".repeat(40), newest: "b".repeat(40) },
		});

	/** Lets `secs` seconds go by on the auto restart's clock, a tick each. */
	const pass = async (secs: number) => {
		for (let i = 0; i < secs; i++) {
			clock.advance(Duration.secs(1));
			await act(async () => {
				timer.fireIntervals();
				await Bun.sleep(0);
			});
		}
	};

	it("counts down in Power, and Cancel closes it without restarting", async () => {
		const view = await open();
		await pass(65);

		const dialog = await waitFor(() =>
			view.getByRole("dialog", { name: /^Updating arbor dev in 0:\d\d$/ }),
		);
		expect(dialog.textContent).toContain("arbor dev will update to bbbbbbbb");
		const left = () =>
			Number(/in 0:(\d\d)/.exec(dialog.textContent ?? "")?.[1]);
		const before = left();
		expect(before).toBeGreaterThan(10);
		await pass(10);
		expect(left()).toBe(before - 10);

		await act(async () =>
			fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" })),
		);
		await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
		expect(testing.posts.map((each) => each.path)).not.toContain(
			"/api/restart",
		);
	});

	it("updates now on Power's Update slide, then reloads once back", async () => {
		const view = await open();
		await pass(65);
		const dialog = await waitFor(() =>
			view.getByRole("dialog", { name: /^Updating arbor dev in/ }),
		);

		await act(async () =>
			fireEvent.click(
				within(dialog).getByRole("button", { name: "Update now" }),
			),
		);
		expect(testing.posts.map((each) => each.path)).toContain("/api/restart");
		await waitFor(() =>
			expect(
				within(dialog).getByRole("listitem", { current: "step" }).textContent,
			).toBe("Update"),
		);
		expect(dialog.textContent).toContain("This page reloads once it is back.");

		testing.run = "run-2";
		await waitFor(() => expect(testing.reloads).toBe(1), { timeout: 3000 });
	});

	it("starts no countdown while Power is open", async () => {
		const view = await open();
		await act(async () => fireEvent.click(await menuItem(view, /^Power/)));
		await waitFor(() => view.getByRole("dialog", { name: "Power" }));

		await pass(125);
		expect(view.getByRole("dialog", { name: "Power" })).toBeTruthy();
	});
});
