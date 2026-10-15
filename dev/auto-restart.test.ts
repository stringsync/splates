import { beforeEach, describe, expect, it } from "bun:test";
import { Duration } from "webappwiz/time";
import { FakeClock, FakeTimer } from "webappwiz/time/testing";
import { AutoRestart } from "./auto-restart";
import { FakeServer } from "./fake-auto-restart-server";
import { Settings } from "./settings";
import "./testing";

describe("AutoRestart", () => {
	let server: FakeServer;
	let settings: Settings;
	let timer: FakeTimer;
	let clock: FakeClock;
	let input: EventTarget;
	let restart: AutoRestart;

	beforeEach(async () => {
		localStorage.clear();
		server = new FakeServer();
		settings = new Settings(localStorage);
		await settings.set("restart.auto", true);
		timer = new FakeTimer();
		clock = new FakeClock();
		input = new EventTarget();
		restart = new AutoRestart(server, settings, { timer, clock, input });
		restart.start();
	});

	/** Lets `secs` seconds go by, a tick each. */
	const pass = async (secs: number) => {
		for (let i = 0; i < secs; i++) {
			clock.advance(Duration.secs(1));
			timer.fireIntervals();
			await Bun.sleep(0);
		}
	};

	it("counts down once every agent has been idle a minute, then restarts", async () => {
		await pass(59);
		expect(restart.state.step).toBe("watching");

		await pass(6);
		expect(restart.state).toMatchObject({
			step: "counting",
			run: "run-1",
			onto: "bbbbbbbb",
		});

		await pass(60);
		expect(server.restarts).toBe(1);
		expect(restart.state).toEqual({
			step: "restarting",
			run: "run-1",
			onto: "bbbbbbbb",
		});
	});

	it("starts no countdown while held, as while Power is open", async () => {
		restart.hold(true);
		await pass(125);
		expect(restart.state.step).toBe("watching");

		restart.hold(false);
		await pass(6);
		expect(restart.state.step).toBe("counting");
	});

	it("does not offer a cancelled restart again", async () => {
		await pass(65);
		restart.cancel();
		await pass(180);

		expect(restart.state.step).toBe("watching");
		expect(server.restarts).toBe(0);
	});

	it("stops counting once an agent goes to work, and the minute starts over", async () => {
		await pass(65);
		server.working(true);
		await pass(1);
		expect(restart.state.step).toBe("watching");

		server.working(false);
		await pass(59);
		expect(restart.state.step).toBe("watching");
		await pass(6);
		expect(restart.state.step).toBe("counting");
	});

	it("waits for a minute without the person pressing, clicking, scrolling or touching", async () => {
		await pass(30);
		input.dispatchEvent(new Event("keydown"));
		await pass(35);
		expect(restart.state.step).toBe("watching");

		await pass(20);
		input.dispatchEvent(new Event("wheel"));
		await pass(59);
		expect(restart.state.step).toBe("watching");
		await pass(6);
		expect(restart.state.step).toBe("counting");
	});

	it("holds off while a command runs that a restart would kill", async () => {
		server.listed = {
			...server.listed,
			held: [{ where: "fixer", command: "bun run dev" }],
		};
		await pass(125);
		expect(restart.state.step).toBe("watching");

		server.listed = { ...server.listed, held: [] };
		await pass(65);
		expect(restart.state.step).toBe("counting");
		server.listed = {
			...server.listed,
			held: [{ where: "terminal", command: "vim" }],
		};
		await pass(1);
		expect(restart.state.step).toBe("watching");
	});

	it("goes to restart when the server goes before it answers", async () => {
		server.restart = async () => {
			server.down = true;
			throw new TypeError("connection refused");
		};
		await pass(65);
		await restart.restartNow();
		expect(restart.state.step).toBe("restarting");
	});

	it("watches again when the restart is refused", async () => {
		server.refuses = true;
		await pass(65);
		await restart.restartNow();

		expect(restart.state.step).toBe("watching");
	});

	it("does nothing while off, up to date, or unable to restart itself", async () => {
		await settings.set("restart.auto", false);
		await pass(130);
		expect(restart.state.step).toBe("watching");

		await settings.set("restart.auto", true);
		server.listed = { ...server.listed, restartable: false };
		await pass(130);
		expect(restart.state.step).toBe("watching");

		server.listed = { ...server.listed, restartable: true, behind: null };
		await pass(130);
		expect(restart.state.step).toBe("watching");
	});
});
