import { describe, expect, it } from "bun:test";
import { OpenPortProvider } from "webappwiz/system";
import { FakeFs } from "webappwiz/system/testing";
import { darwinTemperature } from "./darwin-temperature";
import { dev } from "./dev";
import { Machine, type MachineSensors, thermalZones } from "./machine";
import { Testing } from "./testing";

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
		});
	});

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
		expect(await thermalZones(fs, "/thermal")).toBe(61.5);
	});

	it("reads none without thermal zones", async () => {
		expect(await thermalZones(new FakeFs(), "/thermal")).toBeNull();
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
				`http://localhost:${server.port}/api/machine`,
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
}
