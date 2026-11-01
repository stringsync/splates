import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	setDefaultTimeout,
} from "bun:test";
import { join } from "node:path";
import type { FakePs } from "core/system/testing";
import { eventually } from "../server/testing";
import { Shell } from "../terminal";
import { LIVE_PID, type Testing } from "../testing";
import { openConcurrency } from "./concurrency-fixture";
import { merge } from "./merge";

setDefaultTimeout(30_000);

describe("merge concurrency", () => {
	let deps: Testing;
	let alpha: string;
	let alphaStarted: PromiseWithResolvers<void>;
	let alphaRelease: PromiseWithResolvers<void>;
	let alphaPs: FakePs;
	let initialHead: string;
	beforeEach(async () => {
		({ deps, alpha, initialHead, alphaStarted, alphaRelease, alphaPs } =
			await openConcurrency());
	});
	afterEach(async () => {
		await deps.disposeAsync();
	});
	it("stops on a lost lease even when the gate fails, preserving the rebased tree", async () => {
		await deps.commit(deps.root, "late.txt", "late\n", "move base");
		alphaPs.simulate(async () => {
			const tree = await deps.service.find("alpha");
			await tree.save({
				lease: {
					pid: LIVE_PID,
					hostname: deps.ps.hostname,
					heartbeatAt: new Date().toISOString(),
				},
			});
			return 1;
		});
		await expect(
			merge({ ...deps, shell: new Shell({ ps: alphaPs }) }, alpha),
		).toBail("lease_lost");
		expect(await deps.git.head(alpha)).not.toBe(initialHead);
		expect(await deps.fs.exists(join(alpha, "late.txt"))).toBe(true);
		expect((await deps.service.find("alpha")).mergeAttempts).toBe(0);
		expect(await deps.fs.exists(deps.lockPath)).toBe(false);
	});
	it("keeps the merge's steps and its premerge's phases on the record as it goes", async () => {
		alphaPs.simulate(async () => {
			const phases = alphaPs.getCallEnvs().at(-1)?.SPLATES_GATE_PHASES ?? "";
			await deps.fs.append(
				phases,
				`${JSON.stringify({ phase: "biome", started: "2026-10-26T10:00:00.000Z" })}\n`,
			);
			alphaStarted.resolve();
			await alphaRelease.promise;
			return 0;
		});
		const running = merge(
			{ ...deps, shell: new Shell({ ps: alphaPs }), phasesEveryMs: 20 },
			alpha,
		);
		try {
			await alphaStarted.promise;
			const record = () => deps.service.find("alpha");
			expect(
				await eventually(
					async () => (await record()).mergeSteps?.phases !== undefined,
					10_000,
				),
			).toBe(true);
			expect((await record()).mergeSteps).toEqual({
				steps: [
					{ step: "rebase", at: expect.any(String) },
					{
						step: "test",
						at: expect.any(String),
						// What the premerge prints, for the merge card to follow.
						output: expect.stringMatching(/\/splates-merge-1-test\.log$/),
					},
				],
				phases: [{ phase: "biome", at: "2026-10-26T10:00:00.000Z" }],
			});
		} finally {
			alphaRelease.resolve();
			await running;
		}
	});
});
