import { describe, expect, it } from "bun:test";
import {
	askingKinds,
	bandFromLegacyScore,
	bandOf,
	isTrustBand,
	legacyScoreOfBand,
} from "./band";
import type { TrustDecision } from "./types";

const KEY = { project: "/repo", agent: "claude", model: "Opus 4.6" };

function decision(
	at: string,
	overrides: Partial<TrustDecision> = {},
): TrustDecision {
	return {
		id: `d:${at}`,
		at,
		...KEY,
		kind: "defaults",
		source: "question",
		outcome: "kept",
		subject: "s",
		conversation: null,
		task: null,
		...overrides,
	};
}

describe("trust bands", () => {
	it("recognizes valid TrustBand names and maps legacy 0–100 scores", () => {
		expect(isTrustBand("ask-and-wait")).toBe(true);
		expect(isTrustBand("ask-and-go")).toBe(true);
		expect(isTrustBand("assume")).toBe(true);
		expect(isTrustBand("auto")).toBe(false);
		expect(isTrustBand(80)).toBe(false);

		expect(bandFromLegacyScore(0)).toBe("ask-and-wait");
		expect(bandFromLegacyScore(69)).toBe("ask-and-wait");
		expect(bandFromLegacyScore(70)).toBe("ask-and-go");
		expect(bandFromLegacyScore(89)).toBe("ask-and-go");
		expect(bandFromLegacyScore(90)).toBe("assume");
		expect(bandFromLegacyScore(100)).toBe("assume");

		expect(legacyScoreOfBand("ask-and-wait")).toBe(50);
		expect(legacyScoreOfBand("ask-and-go")).toBe(80);
		expect(legacyScoreOfBand("assume")).toBe(95);
	});

	it("resolves effective band from earned entries and honors the global enabled toggle", () => {
		expect(bandOf({ band: "assume" }, true)).toBe("assume");
		expect(bandOf({ band: "ask-and-go" }, true)).toBe("ask-and-go");
		expect(bandOf({ band: "ask-and-wait" }, true)).toBe("ask-and-wait");
		expect(bandOf({ band: "assume" }, false)).toBe("ask-and-wait");
		expect(bandOf({ band: "ask-and-go" }, false)).toBe("ask-and-wait");
	});

	it("keeps legacy numeric bandOf compatibility for web callers until #4650", () => {
		const counts = (total: number) => ({
			kept: total,
			amended: 0,
			overturned: 0,
			total,
		});
		expect(bandOf({ score: 92, mode: "dynamic", counts: counts(10) })).toBe(
			"assume",
		);
		expect(bandOf({ score: 92, mode: "dynamic", counts: counts(9) })).toBe(
			"ask-and-go",
		);
		expect(bandOf({ score: 92, mode: "static", counts: counts(0) })).toBe(
			"assume",
		);
		expect(bandOf({ score: 69, mode: "static", counts: counts(40) })).toBe(
			"ask-and-wait",
		);
	});

	it("tracks askingKinds until 3 asked picks of that kind are kept", () => {
		const overturned = decision("2026-11-25T01:00:00.000Z", {
			source: "unasked",
			outcome: "overturned",
		});
		const kept = (hour: number) =>
			decision(`2026-11-25T0${hour + 1}:00:00.000Z`);
		expect(askingKinds([overturned], KEY)).toEqual(["defaults"]);
		expect(askingKinds([overturned, kept(1), kept(2)], KEY)).toEqual([
			"defaults",
		]);
		expect(askingKinds([overturned, kept(1), kept(2), kept(3)], KEY)).toEqual(
			[],
		);
		expect(askingKinds([overturned], KEY, "2026-11-25T02:00:00.000Z")).toEqual(
			[],
		);
	});
});
