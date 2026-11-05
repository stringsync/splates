import { describe, expect, it } from "bun:test";
import os from "node:os";
import { darwinAvailable, heldPages } from "./darwin-memory";

describe("darwin memory", () => {
	it("counts app memory, wired and compressed, not file cache", () => {
		const stats = new Uint32Array(40);
		stats[0] = 1000; // free
		stats[2] = 5000; // inactive
		stats[3] = 30; // wired
		stats[22] = 10; // purgeable
		stats[32] = 5; // compressor
		stats[34] = 9000; // file-backed
		stats[35] = 100; // anonymous
		expect(heldPages(stats)).toBe(125);
	});

	it("never takes purgeable below nothing", () => {
		const stats = new Uint32Array(40);
		stats[22] = 10;
		stats[3] = 30;
		expect(heldPages(stats)).toBe(30);
	});

	it.if(process.platform === "darwin")("agrees with vm_stat", () => {
		const total = os.totalmem();
		const { stdout } = Bun.spawnSync(["vm_stat"]);
		const text = stdout.toString();
		const pages = (name: string) =>
			Number(text.match(new RegExp(`${name}:\\s+(\\d+)`))?.[1]);
		const size = Number(text.match(/page size of (\d+)/)?.[1]);
		const held =
			(pages("Anonymous pages") -
				pages("Pages purgeable") +
				pages("Pages wired down") +
				pages("Pages occupied by compressor")) *
			size;
		const available = darwinAvailable(total);
		expect(available).not.toBeNull();
		// The two read moments apart on a machine in use.
		expect(Math.abs((available ?? 0) - (total - held))).toBeLessThan(
			total * 0.05,
		);
	});
});
