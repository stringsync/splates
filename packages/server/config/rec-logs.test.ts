import { describe, expect, it } from "bun:test";
import { recLogSources } from "./rec-logs";

describe("recLogSources", () => {
	it("is none for a config with no rec or no logs", () => {
		expect(recLogSources(undefined)).toEqual([]);
		expect(recLogSources(null)).toEqual([]);
		expect(recLogSources({})).toEqual([]);
	});

	it("keeps each source's name, command, zone and label", () => {
		expect(
			recLogSources({
				logs: [
					{ name: "api", command: "bin/logs api" },
					{ name: "prod-web", command: "x", zone: "utc", label: "Prod" },
				],
			}),
		).toEqual([
			{ name: "api", command: "bin/logs api" },
			{ name: "prod-web", command: "x", zone: "utc", label: "Prod" },
		]);
	});

	it.each([
		[{ logs: "api" }, "is a list"],
		[{ logs: [{ name: "Api", command: "x" }] }, "lowercase"],
		[{ logs: [{ name: "a_b", command: "x" }] }, "lowercase"],
		[
			{
				logs: [
					{ name: "api", command: "x" },
					{ name: "api", command: "y" },
				],
			},
			"twice",
		],
		[{ logs: [{ name: "api", command: " " }] }, "needs a command"],
		[{ logs: [{ name: "api", command: "x", zone: "gmt" }] }, "zone"],
	])("refuses %j", (rec, message) => {
		expect(() => recLogSources(rec)).toThrow(message);
	});
});
