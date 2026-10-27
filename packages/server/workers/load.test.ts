import { describe, expect, it } from "bun:test";
import { NodePs, OpenPortProvider } from "webappwiz/system";
import { FakeFs } from "webappwiz/system/testing";
import { dev } from "../server";
import { Testing } from "../testing";
import { darwinTemperature } from "./darwin-temperature";
import { Machine, type MachineSensors, type ProcessUse } from "./load";
import { OsSensors, ownPids, parseTable } from "./os-sensors";

describe("machine", () => {
	it("reads the CPU share busy since the reading before", async () => {
		const sensors = new FakeSensors();
		const machine = new Machine(sensors);
		sensors.busy = 30;
		sensors.idle = 70;
		expect((await machine.read()).cpu).toBe(0.3);

		sensors.busy = 120;
		sensors.idle = 80;
		expect((await machine.read()).cpu).toBe(0.9);
	});

	it("gives the last CPU share again to a read too soon after it to count any time", async () => {
		const sensors = new FakeSensors();
		const machine = new Machine(sensors);
		sensors.busy = 30;
		sensors.idle = 70;
		await machine.read();
		expect((await machine.read()).cpu).toBe(0.3);
	});

	it("reads memory in use, the load, the cores and the temperature", async () => {
		const sensors = new FakeSensors();
		sensors.hot = 71.5;
		expect(await new Machine(sensors).read()).toEqual({
			kind: "Mac",
			cpu: 0,
			memory: 0.25,
			load: 1.5,
			cores: 2,
			temperature: 71.5,
			splates: { cpu: 0, memory: 0, bytes: 0 },
		});
	});

	it("reads splates' share of memory, and of CPU since the reading before", async () => {
		const sensors = new FakeSensors();
		const machine = new Machine(sensors);
		sensors.busy = 30;
		sensors.idle = 70;
		sensors.processes = [{ pid: 1, cpu: 1, memory: 8 }];
		expect((await machine.read()).splates).toEqual({
			cpu: 0,
			memory: 0.125,
			bytes: 8,
		});

		// 100 ms of CPU over 200 ms of both cores: 20 ms by the one there
		// before, 20 ms by one started since.
		sensors.busy = 130;
		sensors.idle = 70;
		sensors.processes = [
			{ pid: 1, cpu: 1.02, memory: 8 },
			{ pid: 2, cpu: 0.02, memory: 8 },
		];
		const { splates } = await machine.read();
		expect(splates?.cpu).toBeCloseTo(0.2);
		expect(splates?.memory).toBe(0.25);
	});

	it("reads no share for splates where its processes cannot be listed", async () => {
		const sensors = new FakeSensors();
		sensors.splates = () => Promise.resolve(null);
		expect((await new Machine(sensors).read()).splates).toBeNull();
	});

	it("parses the process table, CPU times as macOS and Linux write them", () => {
		expect(
			parseTable(
				[
					"    1     0     1   0:34.88  1024",
					"  200     1   200 123:04.50  2048",
					"  300     1   300 01:02:03   1",
					"  400     1   400 2-00:00:01 1",
					"",
				].join("\n"),
			),
		).toEqual([
			{ pid: 1, ppid: 0, pgid: 1, cpu: 34.88, rss: 1024 * 1024 },
			{ pid: 200, ppid: 1, pgid: 200, cpu: 7384.5, rss: 2048 * 1024 },
			{ pid: 300, ppid: 1, pgid: 300, cpu: 3723, rss: 1024 },
			{ pid: 400, ppid: 1, pgid: 400, cpu: 172_801, rss: 1024 },
		]);
	});

	it("counts a worker reparented out of the supervisor's tree, by its group", () => {
		const row = (pid: number, ppid: number, pgid: number) => ({
			pid,
			ppid,
			pgid,
			cpu: 0,
			rss: 0,
		});
		const table = [
			row(1, 0, 1),
			row(50, 1, 50), // the shell
			row(100, 50, 100), // the supervisor
			row(110, 100, 100), // the server
			row(120, 1, 100), // a worker the last server started, reparented
			row(130, 120, 130), // its agent, in a terminal of its own
			row(140, 50, 100), // a pipe the shell started the supervisor into
			row(150, 1, 150), // someone else's
		];
		expect(
			[...ownPids(table, 100)].sort((left, right) => left - right),
		).toEqual([100, 110, 120, 130]);
	});

	it.if(process.platform !== "win32")(
		"counts this process among splates' own",
		async () => {
			const ps = new NodePs();
			const own = await new OsSensors(new FakeFs(), { ps }).splates();
			const self = own?.find((each) => each.pid === ps.pid);
			expect(self?.memory).toBeGreaterThan(0);
		},
	);

	it("calls a machine other than a Mac a machine", async () => {
		const sensors = new FakeSensors();
		sensors.platform = "linux";
		expect((await new Machine(sensors).read()).kind).toBe("machine");
	});

	it("reads no temperature when the sensor fails", async () => {
		const sensors = new FakeSensors();
		sensors.temperature = () => Promise.reject(new Error("no sensor"));
		expect((await new Machine(sensors).read()).temperature).toBeNull();
	});

	it("reads the hottest zone in °C", async () => {
		const fs = new FakeFs();
		await fs.mkdir("/thermal/thermal_zone0");
		await fs.mkdir("/thermal/thermal_zone1");
		await fs.mkdir("/thermal/cooling_device0");
		await fs.write("/thermal/thermal_zone0/temp", "48000\n");
		await fs.write("/thermal/thermal_zone1/temp", "61500\n");
		await fs.write("/thermal/cooling_device0/temp", "99000\n");
		expect(
			await new OsSensors(fs, { thermal: "/thermal" }).thermalZones(),
		).toBe(61.5);
	});

	it("reads none without thermal zones", async () => {
		expect(
			await new OsSensors(new FakeFs(), { thermal: "/thermal" }).thermalZones(),
		).toBeNull();
	});

	it.if(process.platform === "darwin" && process.arch === "arm64")(
		"reads the hottest CPU die on Apple Silicon, without sudo",
		() => {
			const degrees = darwinTemperature();
			expect(degrees).toBeGreaterThan(15);
			expect(degrees).toBeLessThan(120);
		},
	);

	it("answers /api/machine with the machine's reading", async () => {
		await using deps = await Testing.open();
		const sensors = new FakeSensors();
		const server = await dev(deps, {
			ports: OpenPortProvider.any(),
			sensors,
		});
		try {
			sensors.busy = 50;
			sensors.idle = 50;
			const response = await fetch(
				`http://127.0.0.1:${server.port}/api/machine`,
			);
			expect(await response.json()).toMatchObject({ cpu: 0.5, cores: 2 });
		} finally {
			await server.disposeAsync();
		}
	});
});

/** A machine of two cores whose busy and idle time a test moves on. */
class FakeSensors implements MachineSensors {
	platform: NodeJS.Platform = "darwin";
	busy = 0;
	idle = 0;
	free = 48;
	hot: number | null = null;

	cpus() {
		const times = { user: this.busy, nice: 0, sys: 0, idle: this.idle, irq: 0 };
		return [{ times }, { times }];
	}
	loadavg() {
		return [1.5, 1, 0.5];
	}
	freemem() {
		return this.free;
	}
	totalmem() {
		return 64;
	}
	async temperature() {
		return this.hot;
	}
	processes: ProcessUse[] = [];
	splates(): Promise<ProcessUse[] | null> {
		return Promise.resolve(this.processes);
	}
}
