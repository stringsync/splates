import { describe, expect, it } from "bun:test";
import {
	evaluateTrust,
	groupSessions,
	summarizeTrust,
	TRUST_MILESTONES,
} from "./score";
import type { TrustDecision, TrustSetting } from "./types";

describe("earned trust scoring", () => {
	it("caps a 30-question sweep in one conversation to 1 counted session", () => {
		const sweep = Array.from({ length: 30 }, (_, i) =>
			makeDecision({
				id: `q-${i}`,
				conversation: "sweep-conv",
				at: `2026-11-01T10:${String(i).padStart(2, "0")}:00.000Z`,
				source: "mockup",
				outcome: "kept",
			}),
		);
		const sessions = groupSessions(sweep);
		expect(sessions).toHaveLength(1);
		expect(sessions[0]).toMatchObject({
			id: "sweep-conv",
			kept: 30,
			taste: 0,
			planBack: 0,
			broken: 0,
			forCredit: 1,
			againstCredit: 0,
		});

		const earned = evaluateTrust(sweep);
		expect(earned.band).toBe("ask-and-wait");
		expect(earned.standing).toEqual({
			sessions: 1,
			activeDays: 1,
			agreement: 100,
			cleanStreak: 1,
			brokenInLast5: 0,
			brokenInLast10: 0,
		});
	});

	it("leaves amended-only sessions uncounted and groups standalone incidents by id", () => {
		const decisions = [
			makeDecision({
				id: "am-1",
				conversation: "amended-only",
				at: "2026-11-01T10:00:00.000Z",
				outcome: "amended",
			}),
			makeDecision({
				id: "revert:abc",
				conversation: null,
				at: "2026-11-02T10:00:00.000Z",
				source: "revert",
				outcome: "overturned",
			}),
			makeDecision({
				id: "redo:t2",
				conversation: null,
				at: "2026-11-03T10:00:00.000Z",
				source: "redo",
				outcome: "overturned",
			}),
		];
		const sessions = groupSessions(decisions);
		expect(sessions.map((each) => each.id)).toEqual(["revert:abc", "redo:t2"]);
		expect(sessions[0]).toMatchObject({
			forCredit: 0,
			againstCredit: 2,
			broken: 1,
		});
		const earned = evaluateTrust(decisions);
		expect(earned.standing.sessions).toBe(2);
		expect(earned.standing.activeDays).toBe(2);
		expect(earned.standing.agreement).toBe(0);
		expect(earned.standing.cleanStreak).toBe(0);
		expect(earned.standing.brokenInLast5).toBe(2);
	});

	it("weighs taste half inside a session, plans full, and broken trust 2x", () => {
		const sessions = groupSessions([
			makeDecision({
				id: "d1",
				conversation: "mix",
				at: "2026-11-01T10:00:00.000Z",
				source: "question",
				outcome: "kept",
			}),
			makeDecision({
				id: "d2",
				conversation: "mix",
				at: "2026-11-01T10:01:00.000Z",
				source: "mockup",
				outcome: "overturned",
			}),
			makeDecision({
				id: "d3",
				conversation: "mix",
				at: "2026-11-01T10:02:00.000Z",
				source: "plan",
				outcome: "overturned",
			}),
			makeDecision({
				id: "d4",
				conversation: "mix",
				at: "2026-11-01T10:03:00.000Z",
				source: "unasked",
				outcome: "overturned",
			}),
		]);
		expect(sessions).toHaveLength(1);
		// M = 1 kept + 1 taste + 1 planBack = 3
		// for = 1/3, against = (0.5*1 + 1.0*1)/3 + 2.0*1 = 0.5 + 2 = 2.5
		expect(sessions[0]?.forCredit).toBeCloseTo(1 / 3, 6);
		expect(sessions[0]?.againstCredit).toBeCloseTo(2.5, 6);
	});

	it("enforces calendar-day pacing for Ask & go (12 sessions, 4 days) and Assume (35 sessions, 10 days)", () => {
		// 12 clean sessions over only 3 calendar days stays ask-and-wait.
		const tooFastGo = cleanSessions(12, 3);
		expect(evaluateTrust(tooFastGo).band).toBe("ask-and-wait");
		expect(evaluateTrust(tooFastGo).standing.activeDays).toBe(3);

		// Adding a 4th day promotes to ask-and-go.
		const readyGo = [
			...tooFastGo,
			makeDecision({
				id: "day4",
				conversation: "day4",
				at: "2026-11-04T12:00:00.000Z",
				outcome: "kept",
			}),
		];
		expect(evaluateTrust(readyGo).band).toBe("ask-and-go");
		expect(evaluateTrust(readyGo).standing.activeDays).toBe(4);

		// 35 clean sessions over only 9 calendar days stays ask-and-go.
		const tooFastAssume = cleanSessions(35, 9);
		expect(evaluateTrust(tooFastAssume).band).toBe("ask-and-go");
		expect(evaluateTrust(tooFastAssume).standing.activeDays).toBe(9);

		// Adding a 10th calendar day promotes to assume.
		const readyAssume = [
			...tooFastAssume,
			makeDecision({
				id: "day10",
				conversation: "day10",
				at: "2026-11-10T12:00:00.000Z",
				outcome: "kept",
			}),
		];
		expect(evaluateTrust(readyAssume).band).toBe("assume");
		expect(evaluateTrust(readyAssume).standing.activeDays).toBe(10);
	});

	it("absorbs a rough exploratory chat via hysteresis without demoting Ask & go", () => {
		const base = cleanSessions(12, 4);
		expect(evaluateTrust(base).band).toBe("ask-and-go");

		// A rough exploratory conversation with 5 taste overturns + 1 kept pick
		// counts as only 1 session with light taste weighting, keeping agreement well above 65%.
		const roughChat = [
			makeDecision({
				id: "r0",
				conversation: "rough-chat",
				at: "2026-11-05T10:00:00.000Z",
				source: "question",
				outcome: "kept",
			}),
			...Array.from({ length: 5 }, (_, i) =>
				makeDecision({
					id: `r-${i + 1}`,
					conversation: "rough-chat",
					at: `2026-11-05T10:0${i + 1}:00.000Z`,
					source: "mockup",
					outcome: "overturned",
				}),
			),
		];
		const afterRough = evaluateTrust([...base, ...roughChat]);
		expect(afterRough.band).toBe("ask-and-go");
		expect(afterRough.standing.sessions).toBe(13);
		expect(afterRough.standing.agreement).toBeGreaterThanOrEqual(
			TRUST_MILESTONES.askAndGo.demoteAgreement,
		);
	});

	it("demotes Assume immediately on broken trust and requires 10 clean sessions to re-enter", () => {
		const base = cleanSessions(35, 10);
		expect(evaluateTrust(base).band).toBe("assume");

		// One reverted merge immediately steps Assume down to Ask & go.
		const revert = makeDecision({
			id: "revert:sha1",
			conversation: null,
			at: "2026-11-11T12:00:00.000Z",
			source: "revert",
			outcome: "overturned",
		});
		const afterRevert = evaluateTrust([...base, revert]);
		expect(afterRevert.band).toBe("ask-and-go");
		expect(afterRevert.standing.cleanStreak).toBe(0);
		expect(afterRevert.standing.brokenInLast5).toBe(1);

		// 9 clean sessions are not enough to re-enter Assume (cleanStreak === 9).
		const nineClean = cleanSessions(9, 3, { startDay: 12, prefix: "rec" });
		const afterNine = evaluateTrust([...base, revert, ...nineClean]);
		expect(afterNine.band).toBe("ask-and-go");
		expect(afterNine.standing.cleanStreak).toBe(9);

		// The 10th clean session re-enters Assume.
		const tenthClean = makeDecision({
			id: "rec-10",
			conversation: "rec-10",
			at: "2026-11-16T12:00:00.000Z",
			outcome: "kept",
		});
		const afterTen = evaluateTrust([...base, revert, ...nineClean, tenthClean]);
		expect(afterTen.band).toBe("assume");
		expect(afterTen.standing.cleanStreak).toBe(10);
	});

	it("falls through from Assume to Ask & wait when two broken incidents occur in the last 10 sessions", () => {
		const base = cleanSessions(35, 10);
		expect(evaluateTrust(base).band).toBe("assume");

		const twoBroken = [
			makeDecision({
				id: "b1",
				conversation: "b1",
				at: "2026-11-11T10:00:00.000Z",
				source: "unasked",
				outcome: "overturned",
			}),
			makeDecision({
				id: "b2",
				conversation: "b2",
				at: "2026-11-11T11:00:00.000Z",
				source: "redo",
				outcome: "overturned",
			}),
		];
		const after = evaluateTrust([...base, ...twoBroken]);
		expect(after.band).toBe("ask-and-wait");
		expect(after.standing.brokenInLast10).toBe(2);
	});

	it("steps up at most one level per session when recovering after demotion", () => {
		const base = cleanSessions(35, 10);
		// Two broken incidents in one session drop Assume straight to Ask & wait.
		const doubleBroken = [
			makeDecision({
				id: "b1",
				conversation: "bad-chat",
				at: "2026-11-11T10:00:00.000Z",
				source: "unasked",
				outcome: "overturned",
			}),
			makeDecision({
				id: "b2",
				conversation: "bad-chat",
				at: "2026-11-11T10:01:00.000Z",
				source: "unasked",
				outcome: "overturned",
			}),
		];
		expect(evaluateTrust([...base, ...doubleBroken]).band).toBe("ask-and-wait");

		// 5 clean sessions promote back to ask-and-go (not straight to assume).
		const fiveClean = cleanSessions(5, 2, { startDay: 12, prefix: "up" });
		expect(evaluateTrust([...base, ...doubleBroken, ...fiveClean]).band).toBe(
			"ask-and-go",
		);
	});

	it("computes agreement over only the last 25 counted sessions", () => {
		// 10 bad sessions followed by 25 clean sessions: the old 10 fall out of the 25-session window.
		const bad = Array.from({ length: 10 }, (_, i) =>
			makeDecision({
				id: `bad-${i}`,
				conversation: `bad-${i}`,
				at: `2026-11-01T${String(i).padStart(2, "0")}:00:00.000Z`,
				source: "plan",
				outcome: "overturned",
			}),
		);
		const good = cleanSessions(25, 10, { startDay: 2, prefix: "good" });
		const earned = evaluateTrust([...bad, ...good]);
		expect(earned.standing.sessions).toBe(35);
		expect(earned.standing.agreement).toBe(100);
		expect(earned.band).toBe("assume");
	});

	it("summarizes buckets with resetAt, static band overrides, legacy value migration, and askingKinds", () => {
		const decisions = [
			...cleanSessions(12, 4),
			makeDecision({
				id: "unasked-1",
				conversation: "c-overturn",
				at: "2026-11-05T12:00:00.000Z",
				kind: "defaults",
				source: "unasked",
				outcome: "overturned",
			}),
		];
		const settings: TrustSetting[] = [
			{
				project: "/repo",
				agent: "claude",
				model: "Opus 4.6",
				mode: "static",
				band: "assume",
				resetAt: null,
				updatedAt: "2026-11-06T00:00:00.000Z",
			},
			// Legacy numeric setting without `band` migrates transparently.
			{
				project: "/repo",
				agent: "codex",
				model: "GPT-5",
				mode: "static",
				band: null,
				value: 82,
				resetAt: null,
				updatedAt: "2026-11-06T00:00:00.000Z",
			},
		];
		const entries = summarizeTrust(decisions, settings);
		const claude = entries.find((each) => each.agent === "claude");
		expect(claude?.mode).toBe("static");
		expect(claude?.band).toBe("assume");
		expect(claude?.pinnedBand).toBe("assume");
		expect(claude?.earnedBand).toBe("ask-and-go");
		expect(claude?.asking).toEqual(["defaults"]);

		const codex = entries.find((each) => each.agent === "codex");
		expect(codex?.band).toBe("ask-and-go");
		expect(codex?.pinnedBand).toBe("ask-and-go");
		expect(codex?.earnedBand).toBe("ask-and-wait");
	});
});

function makeDecision(
	overrides: Partial<TrustDecision> & {
		at: string;
		outcome: TrustDecision["outcome"];
	},
): TrustDecision {
	return {
		id: `d-${overrides.at}-${Math.random()}`,
		project: "/repo",
		agent: "claude",
		model: "Opus 4.6",
		kind: "design",
		source: "question",
		subject: "Choice?",
		conversation: "c1",
		task: "t1",
		...overrides,
	};
}

/** Generates `count` clean kept sessions spread across `days` calendar dates starting at `startDay`. */
function cleanSessions(
	count: number,
	days: number,
	{ startDay = 1, prefix = "s" }: { startDay?: number; prefix?: string } = {},
): TrustDecision[] {
	const out: TrustDecision[] = [];
	for (let i = 0; i < count; i += 1) {
		const dayOffset = Math.min(days - 1, Math.floor((i * days) / count));
		const day = startDay + dayOffset;
		const month = day <= 30 ? 11 : 12;
		const dom = day <= 30 ? day : day - 30;
		const dd = String(dom).padStart(2, "0");
		const mm = String(month).padStart(2, "0");
		const hh = String(i % 24).padStart(2, "0");
		const min = String((i * 7) % 60).padStart(2, "0");
		out.push(
			makeDecision({
				id: `${prefix}-${i}`,
				conversation: `${prefix}-${i}`,
				at: `2026-${mm}-${dd}T${hh}:${min}:00.000Z`,
				outcome: "kept",
			}),
		);
	}
	return out;
}
