import { describe, expect, it } from "bun:test";
import { MemoryStorage } from "../storage/testing";
import { SignalBook } from "./book";
import { pageKillOf, reportPageKill } from "./page-kills";

const home = () => {
	const now = Date.parse("2026-11-19T12:00:00Z");
	return {
		book: new SignalBook(
			new MemoryStorage().document("signals.json"),
			() => now,
		),
		all: async () => [],
		fire: async () => {},
	};
};
const kill = { conversation: "c1", messages: 900, agent: "iPhone" };

describe("reportPageKill", () => {
	it("raises the repeated signal from the third kill of the week", async () => {
		const signals = home();
		await reportPageKill(signals, kill);
		await reportPageKill(signals, kill);
		expect(
			(await signals.book.raises())["splates.page-kills-repeated"],
		).toBeUndefined();
		expect(await reportPageKill(signals, kill)).toEqual({ kills: 3 });
		const raised = (await signals.book.raises())["splates.page-kills-repeated"];
		expect(raised?.length).toBe(1);
		expect(raised?.[0]?.payload).toMatchObject({ kills: 3 });
	});

	it("needs an agent and keeps the rest when typed", () => {
		expect(pageKillOf({})).toBeNull();
		expect(pageKillOf({ agent: "x", messages: "9" })).toEqual({
			conversation: null,
			messages: null,
			agent: "x",
		});
	});
});
