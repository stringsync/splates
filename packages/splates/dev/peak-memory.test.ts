import { describe, expect, it } from "bun:test";
import { FakePs } from "webappwiz/system/testing";
import { Duration } from "webappwiz/time";
import { descendantsKb, PeakMemory, runSummary } from "./peak-memory";

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
	it("sums the RSS of every descendant, leaving out the root and the rest", () => {
		expect(descendantsKb(LISTING, 10)).toBe(1_024_288);
	});

	it("is nothing for a process with no children", () => {
		expect(descendantsKb(LISTING, 30)).toBe(0);
	});

	it("keeps the most the tree held while the run lasted", async () => {
		const ps = new FakePs();
		ps.pid = 10;
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
