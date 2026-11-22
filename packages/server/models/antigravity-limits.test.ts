import { describe, expect, it } from "bun:test";
import { AGY_ARGV } from "./antigravity";
import {
	antigravityLimits,
	antigravityLimitsIn,
	isAntigravity,
} from "./antigravity-limits";

const AT = "2026-11-21T22:00:00.000Z";
const payload = (buckets: unknown[]) => ({
	status: "SUCCESS",
	command: {
		name: "usage",
		data: { groups: [{ name: "Gemini Models", buckets }] },
	},
});
const bucket = {
	name: "Weekly Limit Remaining",
	remaining_fraction: 0.75,
	reset_time: "2026-11-28T21:27:05Z",
};
const deps = { now: () => Date.parse(AT), cwd: "/repo" };

describe("Antigravity quota", () => {
	it("reads independent quota groups and windows, including unused and exhausted quota", () => {
		expect(
			antigravityLimitsIn(
				{
					status: "SUCCESS",
					command: {
						name: "usage",
						data: {
							groups: [
								{
									name: "Gemini Models",
									buckets: [
										bucket,
										{
											...bucket,
											name: "Five Hour Limit Remaining",
											remaining_fraction: 0,
										},
									],
								},
								{
									name: "Claude and GPT models",
									buckets: [{ ...bucket, remaining_fraction: 1 }],
								},
							],
						},
					},
				},
				AT,
			),
		).toEqual([
			{
				window: "Gemini Models · Weekly",
				used: 0.25,
				resets: "2026-11-28T21:27:05.000Z",
				at: AT,
			},
			{
				window: "Gemini Models · Five Hour",
				used: 1,
				resets: "2026-11-28T21:27:05.000Z",
				at: AT,
			},
			{
				window: "Claude and GPT models · Weekly",
				used: 0,
				resets: "2026-11-28T21:27:05.000Z",
				at: AT,
			},
		]);
	});
	it.each([
		null,
		{},
		{ used: 100, size: 200 },
		{ ...payload([bucket]), status: "ERROR" },
	])("leaves unavailable quota unknown: %j", (value) => {
		expect(antigravityLimitsIn(value, AT)).toEqual([]);
	});
	it.each([undefined, null, "0.5", NaN, Infinity, -1, 2])(
		"rejects malformed fractions: %s",
		(remaining) => {
			expect(
				antigravityLimitsIn(
					payload([{ ...bucket, remaining_fraction: remaining }]),
					AT,
				),
			).toEqual([]);
		},
	);
	it("rejects invalid reset times", () => {
		expect(
			antigravityLimitsIn(payload([{ ...bucket, reset_time: "invalid" }]), AT),
		).toEqual([]);
	});
	it("runs only the usage slash command with bounded execution", async () => {
		const calls: unknown[] = [];
		expect(
			await antigravityLimits({
				...deps,
				ps: {
					spawnCapture: async (...args: unknown[]) => {
						calls.push(args);
						return {
							exitCode: 0,
							stdout: JSON.stringify(payload([bucket])),
							stderr: "",
						};
					},
				},
			}),
		).toEqual([
			{
				window: "Gemini Models · Weekly",
				used: 0.25,
				resets: "2026-11-28T21:27:05.000Z",
				at: AT,
			},
		]);
		expect(calls).toEqual([
			[
				expect.arrayContaining([
					"--print",
					"/usage",
					"--output-format",
					"json",
				]),
				{ cwd: "/repo", stdin: "", timeoutMs: 20_000 },
			],
		]);
	});
	it.each([
		{ exitCode: 1, stdout: JSON.stringify(payload([bucket])), stderr: "" },
		{ exitCode: 0, stdout: "bad JSON", stderr: "" },
	])("leaves failed CLI reads unknown: %j", async (result) => {
		expect(
			await antigravityLimits({
				...deps,
				ps: { spawnCapture: async () => result },
			}),
		).toEqual([]);
	});
	it("handles a missing CLI", async () => {
		expect(
			await antigravityLimits({
				...deps,
				ps: {
					spawnCapture: async () => {
						throw new Error("not installed");
					},
				},
			}),
		).toEqual([]);
	});
	it.each([
		{ argv: AGY_ARGV },
		{ argv: ["agy", "acp"] },
		{ argv: ["/opt/bin/agy", "acp"] },
	])("recognizes Antigravity: %j", ({ argv }) => {
		expect(isAntigravity({ id: "a", name: "a", argv: [...argv] })).toBe(true);
	});
	it.each([
		{ argv: ["gemini", "--experimental-acp"] },
		{ argv: ["imagynary", "acp"] },
	])("ignores other agents: %j", ({ argv }) => {
		expect(isAntigravity({ id: "a", name: "a", argv: [...argv] })).toBe(false);
	});
});
