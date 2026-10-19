import { describe, expect, it } from "bun:test";
import { Duration } from "webappwiz/time";
import { DIFFICULTY_IDS, KIND_IDS } from "./classes";
import { classify, DETAIL_CHARS } from "./classify";
import { FakeJudge } from "./testing";

describe("classify", () => {
	it("asks every question in one judgment of the subject and detail", async () => {
		const judge = new FakeJudge();
		await classify({ subject: "Fix the login", detail: "It 500s", judge });
		expect(judge.asked).toHaveLength(1);
		const [judgment] = judge.asked;
		expect(judgment?.state).toEqual({
			subject: "Fix the login",
			detail: "It 500s",
		});
		expect(Object.keys(judgment?.questions ?? {}).sort()).toEqual(
			[
				...KIND_IDS.map((id) => `kind:${id}`),
				...DIFFICULTY_IDS.map((id) => `difficulty:${id}`),
			].sort(),
		);
	});

	it("cuts a long detail short", async () => {
		const judge = new FakeJudge();
		await classify({
			subject: "s",
			detail: "x".repeat(DETAIL_CHARS + 100),
			judge,
		});
		expect(judge.asked[0]?.state.detail).toBe("x".repeat(DETAIL_CHARS));
	});

	it("reads the answers by class, a coin toss for any missing", async () => {
		const judge = new FakeJudge({
			"kind:bugfix": 0.9,
			"difficulty:hard": 0.1,
		});
		expect(await classify({ subject: "s", detail: "d", judge })).toEqual({
			ok: true,
			classification: {
				kinds: {
					lookup: 0.5,
					mechanical: 0.5,
					bugfix: 0.9,
					design: 0.5,
					open: 0.5,
				},
				difficulty: { easy: 0.5, medium: 0.5, hard: 0.1 },
			},
		});
	});

	it("says which creds to keep when there is no judge", async () => {
		expect(await classify({ subject: "s", detail: "d", judge: null })).toEqual({
			ok: false,
			reason:
				"no judge: keep TYPESAFE_API_KEY for Jev, or CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN for Clef",
		});
	});

	it("says how the judge failed", async () => {
		const judge = {
			judge: () => Promise.reject(new Error("Jev answered 401")),
		};
		expect(await classify({ subject: "s", detail: "d", judge })).toEqual({
			ok: false,
			reason: "the judge failed (Jev answered 401)",
		});
	});

	it("gives up on a judge that takes too long, though it ignores the signal", async () => {
		const judge = { judge: () => new Promise<never>(() => {}) };
		expect(
			await classify({
				subject: "s",
				detail: "d",
				judge,
				timeout: Duration.ms(10),
			}),
		).toEqual({ ok: false, reason: "the judge took over 0.01s" });
	});

	it("rejects with the caller's reason when the caller aborts", async () => {
		const controller = new AbortController();
		controller.abort(new Error("gone"));
		await expect(
			classify({
				subject: "s",
				detail: "d",
				judge: new FakeJudge(),
				signal: controller.signal,
			}),
		).rejects.toThrow("gone");
	});
});
