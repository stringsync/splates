import { describe, expect, it } from "bun:test";
import { Duration } from "webappwiz/time";
import { CONTEXT_CLASSES, DEPTH_IDS, KIND_IDS } from "./classes";
import { classify, DETAIL_CHARS } from "./classify";
import { FakeJudge } from "./testing";

describe("classify", () => {
	it("asks every question in one judgment of the subject and detail", async () => {
		const judge = new FakeJudge();
		await classify({ subject: "Fix the login", detail: "It 500s", judge });
		expect(judge.asked).toHaveLength(1);
		const [judgment] = judge.asked;
		expect(judgment?.state).toMatchObject({
			subject: "Fix the login",
			detail: "It 500s",
		});
		expect(Object.keys(judgment?.questions ?? {}).sort()).toEqual(
			[
				...KIND_IDS.map((id) => `kind:${id}`),
				...DEPTH_IDS.map((id) => `depth:${id}`),
				...Object.entries(CONTEXT_CLASSES).flatMap(([group, classes]) =>
					classes.map((each) => `${group}:${each.id}`),
				),
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
			"depth:deep": 0.1,
		});
		expect(await classify({ subject: "s", detail: "d", judge })).toEqual({
			ok: true,
			classification: {
				kinds: {
					bugfix: 0.9,
					design: 0.5,
					open: 0.5,
				},
				depth: { shallow: 0.5, moderate: 0.5, deep: 0.1 },
				breadth: { spot: 0.5, module: 0.5, system: 0.5 },
				clarity: { settled: 0.5, unresolved: 0.5 },
				stakes: { routine: 0.5, sensitive: 0.5 },
				verification: { automated: 0.5, visual: 0.5 },
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

	it("sends named paths beyond the detail limit and attachment metadata only", async () => {
		const judge = new FakeJudge();
		await classify({
			subject: "Adjust the header",
			detail: `${"x".repeat(DETAIL_CHARS)} See packages/web/header.tsx`,
			judge,
			attachments: [
				{ name: "header-390.png", mimeType: "image/png" },
				{ name: "menu-open.png", mimeType: "image/png" },
				{ name: "bug.mov", mimeType: "video/quicktime" },
			],
		});
		expect(judge.asked[0]?.state).toMatchObject({
			paths: ["packages/web/header.tsx"],
			attachments:
				"2 images (header-390.png, menu-open.png), 1 video (bug.mov)",
		});
	});
});
