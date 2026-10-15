import { beforeEach, describe, expect, it } from "bun:test";
import { Duration } from "webappwiz/time";
import { FakeClock, FakeTimer, FakeWallClock } from "webappwiz/time/testing";
import { AutoRestart, type AutoRestartServer } from "./auto-restart";
import type { ProjectConversation, Projects } from "./project-api";
import { Settings } from "./settings";
import "./testing";

/** This project, with `conversations` live in it. */
const here = (conversations: ProjectConversation[] = []) => ({
	slug: "repo",
	root: "/repo",
	gone: false,
	here: true,
	conversations,
	waiting: 0,
});

/** An `arbor dev` whose projects a test sets, which restarts when asked. */
class FakeServer implements AutoRestartServer {
	listed: Projects = {
		projects: [here()],
		servers: [],
		restarting: null,
		restarted: null,
		run: "run-1",
		running: "0.0.43",
		newest: null,
		behind: { running: "a".repeat(40), newest: "b".repeat(40) },
		restartable: true,
		held: [],
	};
	restarts = 0;
	down = false;
	refuses = false;

	async list(): Promise<Projects> {
		if (this.down) {
			throw new TypeError("no server");
		}
		return this.listed;
	}

	async restart(): Promise<void> {
		if (this.refuses) {
			throw new Error("agents are at work");
		}
		this.restarts += 1;
		this.down = true;
	}

	/** Comes back as another run, up to date. */
	back(): void {
		this.down = false;
		this.listed = { ...this.listed, run: "run-2", behind: null };
	}

	/** Puts one agent at work, or none. */
	working(on: boolean): void {
		this.listed = {
			...this.listed,
			projects: [
				here(
					on
						? [{ id: "c1", name: "c1", status: "running", checkpoint: null }]
						: [],
				),
			],
		};
	}
}

describe("AutoRestart", () => {
	let server: FakeServer;
	let settings: Settings;
	let timer: FakeTimer;
	let clock: FakeClock;
	let wall: FakeWallClock;
	let input: EventTarget;
	let reloads: number;
	let restart: AutoRestart;

	beforeEach(async () => {
		localStorage.clear();
		sessionStorage.clear();
		server = new FakeServer();
		settings = new Settings(localStorage);
		await settings.set("restart.auto", "reload");
		timer = new FakeTimer();
		clock = new FakeClock();
		wall = new FakeWallClock(1_000_000);
		input = new EventTarget();
		reloads = 0;
		restart = new AutoRestart(server, settings, {
			timer,
			clock,
			wall,
			input,
			storage: sessionStorage,
			reload: () => {
				reloads += 1;
			},
		});
		restart.start();
	});

	/** Lets `secs` seconds go by, a tick each. */
	const pass = async (secs: number) => {
		for (let i = 0; i < secs; i++) {
			clock.advance(Duration.secs(1));
			wall.advance(Duration.secs(1));
			timer.fireIntervals();
			await Bun.sleep(0);
		}
	};

	it("counts down once every agent has been idle a minute, then restarts and reloads", async () => {
		await pass(59);
		expect(restart.state.step).toBe("watching");

		await pass(6);
		expect(restart.state).toMatchObject({
			step: "counting",
			reload: true,
			onto: "bbbbbbbb",
		});

		await pass(60);
		expect(server.restarts).toBe(1);
		expect(restart.state.step).toBe("restarting");

		server.back();
		await pass(1);
		expect(reloads).toBe(1);
		expect(
			JSON.parse(sessionStorage.getItem("arbor.autoRestarted") ?? "null"),
		).toEqual({ onto: "bbbbbbbb", at: wall.now() });
	});

	it("says it is back after the reload, once, and how long ago", () => {
		sessionStorage.setItem(
			"arbor.autoRestarted",
			JSON.stringify({ onto: "bbbbbbbb", at: wall.now() }),
		);
		const after = new AutoRestart(server, settings, {
			timer,
			clock,
			wall,
			input,
			storage: sessionStorage,
			reload: () => {},
		});
		after.start();

		expect(after.state).toEqual({
			step: "back",
			reloaded: true,
			onto: "bbbbbbbb",
			at: wall.now(),
		});
		wall.advance(Duration.mins(3));
		expect(after.ago()?.mins).toBe(3);
		after.dismiss();
		expect(after.ago()).toBeNull();
		expect(after.state.step).toBe("watching");
		expect(sessionStorage.getItem("arbor.autoRestarted")).toBeNull();
	});

	it("says it is back without reloading when only a restart is asked for", async () => {
		await settings.set("restart.auto", "restart");
		await pass(65);
		await restart.restartNow();
		server.back();
		await pass(1);

		expect(reloads).toBe(0);
		expect(restart.state).toEqual({
			step: "back",
			reloaded: false,
			onto: "bbbbbbbb",
			at: wall.now(),
		});
	});

	it("counts down to the next restart while still saying it is back", async () => {
		await settings.set("restart.auto", "restart");
		await pass(65);
		await restart.restartNow();
		server.back();
		await pass(1);
		expect(restart.state.step).toBe("back");

		server.listed = {
			...server.listed,
			behind: { running: "b".repeat(40), newest: "c".repeat(40) },
		};
		await pass(55);
		expect(restart.state.step).toBe("back");
		await pass(10);
		expect(restart.state).toMatchObject({ step: "counting", onto: "cccccccc" });
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

	it("waits on the restart when the server goes before it answers", async () => {
		server.restart = async () => {
			server.down = true;
			throw new TypeError("connection refused");
		};
		await pass(65);
		await restart.restartNow();
		expect(restart.state.step).toBe("restarting");

		server.back();
		await pass(1);
		expect(reloads).toBe(1);
	});

	it("watches again when the restart is refused", async () => {
		server.refuses = true;
		await pass(65);
		await restart.restartNow();

		expect(restart.state.step).toBe("watching");
	});

	it("does nothing while off, up to date, or unable to restart itself", async () => {
		await settings.set("restart.auto", "off");
		await pass(130);
		expect(restart.state.step).toBe("watching");

		await settings.set("restart.auto", "restart");
		server.listed = { ...server.listed, restartable: false };
		await pass(130);
		expect(restart.state.step).toBe("watching");

		server.listed = { ...server.listed, restartable: true, behind: null };
		await pass(130);
		expect(restart.state.step).toBe("watching");
	});
});
