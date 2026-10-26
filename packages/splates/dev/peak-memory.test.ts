import { describe, expect, it } from "bun:test";
import { FakePs } from "webappwiz/system/testing";
import { Duration } from "webappwiz/time";
import {
	descendants,
	footprintKb,
	PeakMemory,
	runSummary,
} from "./peak-memory";

/** This process, 10, runs bun test, 20, whose workers 21 and 22 run git, 30; 99 is no kin. */
const LISTING = [
	"   10     1  50000",
	"   20    10 100000",
	"   21    20 400000",
	"   22    20 500000",
	"   30    22  24288",
	"   99     1 900000",
	"",
].join("\n");

describe("PeakMemory", () => {
	it("lists every descendant with its RSS, leaving out the root and the rest", () => {
		expect(descendants(LISTING, 10)).toEqual([
			{ pid: 20, kb: 100000 },
			{ pid: 21, kb: 400000 },
			{ pid: 22, kb: 500000 },
			{ pid: 30, kb: 24288 },
		]);
	});

	it("is nothing for a process with no children", () => {
		expect(descendants(LISTING, 30)).toEqual([]);
	});

	it("sums the footprints macOS printed, in whatever unit each came", () => {
		expect(footprintKb(FOOTPRINTS)).toBe(
			Math.round(96.5 * 1024 + 1.25 * 1024 * 1024 + 2528),
		);
		expect(footprintKb("")).toBeNull();
	});

	it("measures the tree's physical footprint on macOS, asking for each process listed", async () => {
		const ps = new FakePs();
		ps.pid = 10;
		ps.platform = "darwin";
		// one answer serves both commands: `ps` skips the footprint lines, and
		// `footprint` the listing's
		ps.setCaptureOutput(`${LISTING}${FOOTPRINTS}`, "");

		const { peakMb } = await new PeakMemory(ps, Duration.ms(1)).during(
			async () => {
				await Bun.sleep(5);
			},
		);

		expect(peakMb).toBe(
			Math.round((96.5 * 1024 + 1.25 * 1024 * 1024 + 2528) / 1024),
		);
		expect(ps.getCalls()[1]).toBe("footprint -p 20 -p 21 -p 22 -p 30");
	});

	it("keeps the most the tree held while the run lasted", async () => {
		const ps = new FakePs();
		ps.pid = 10;
		ps.platform = "linux";
		ps.setCaptureOutput(LISTING, "");

		const { value, peakMb } = await new PeakMemory(ps, Duration.ms(1)).during(
			async () => {
				await Bun.sleep(5);
				return "ran";
			},
		);

		expect(value).toBe("ran");
		expect(peakMb).toBe(1000);
		expect(ps.getCalls()[0]).toBe("ps -axo pid=,ppid=,rss=");
	});

	it("measures nothing on Windows, where ps lists no processes", async () => {
		const ps = new FakePs();
		ps.platform = "win32";

		expect(await new PeakMemory(ps).during(async () => 1)).toEqual({
			value: 1,
			peakMb: null,
		});
		expect(ps.getCalls()).toEqual([]);
	});

	it("reads out a run's time, workers and peak", () => {
		expect(
			runSummary({
				phase: "server tests",
				took: Duration.secs(41),
				workers: 4,
				peakMb: 1280,
			}),
		).toBe(
			`server tests: ${Duration.secs(41).human()} on 4 workers, peak 1.25 GB`,
		);
		expect(
			runSummary({
				phase: "eval tests",
				took: Duration.secs(2),
				workers: 1,
				peakMb: 349,
			}),
		).toEndWith("on 1 worker, peak 349 MB");
	});

	it("leaves out the peak where it could not be measured", () => {
		expect(
			runSummary({
				phase: "web tests",
				took: Duration.secs(2),
				workers: 2,
				peakMb: null,
			}),
		).toEndWith("on 2 workers");
	});
});

/** What `footprint -p 20 -p 21 -p 22 -p 30` prints once 21 has exited. */
const FOOTPRINTS = [
	"======================================================================",
	"bun [20]: 64-bit    Footprint: 96.5 MB (16384 bytes per page)",
	"======================================================================",
	"",
	"  Dirty      Clean  Reclaimable    Regions    Category",
	"",
	"======================================================================",
	"bun [22]: 64-bit    Footprint: 1.25 GB (16384 bytes per page)",
	"======================================================================",
	"======================================================================",
	"git [30]: 64-bit    Footprint: 2528 KB (16384 bytes per page)",
	"======================================================================",
	"",
].join("\n");
