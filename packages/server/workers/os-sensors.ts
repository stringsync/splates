import os from "node:os";
import type { Fs } from "webappwiz/system";
import { darwinTemperature } from "./darwin-temperature";
import type { MachineSensors } from "./load";

/**
 * The machine this process runs on. Temperature is read from Linux's thermal
 * zones under `thermal`, and from the CPU die sensors on Apple Silicon; null
 * elsewhere.
 */
export class OsSensors implements MachineSensors {
	readonly platform = process.platform;

	constructor(
		private readonly fs: Fs,
		private readonly thermal = "/sys/class/thermal",
	) {}

	cpus() {
		return os.cpus();
	}

	loadavg(): number[] {
		return os.loadavg();
	}

	freemem(): number {
		return os.freemem();
	}

	totalmem(): number {
		return os.totalmem();
	}

	async temperature(): Promise<number | null> {
		return this.platform === "linux"
			? this.thermalZones()
			: this.platform === "darwin"
				? darwinTemperature()
				: null;
	}

	/** The hottest of Linux's thermal zones, in °C, or null for none. */
	async thermalZones(): Promise<number | null> {
		if (!(await this.fs.exists(this.thermal))) {
			return null;
		}
		let hottest: number | null = null;
		for (const zone of await this.fs.readdir(this.thermal)) {
			if (!zone.startsWith("thermal_zone")) {
				continue;
			}
			// In thousandths of a degree.
			const milli = Number(
				(
					await this.fs.read(`${this.thermal}/${zone}/temp`).catch(() => "")
				).trim(),
			);
			if (Number.isFinite(milli) && milli > 0) {
				hottest = Math.max(hottest ?? 0, milli / 1000);
			}
		}
		return hottest;
	}
}
