import { describe, expect, it } from "bun:test";
import { MemoryStorage } from "../storage/testing";
import { checkName, SignalBook } from "./book";
import { sinceOf } from "./time";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("SignalBook", () => {
	const make = () => {
		const clock = { at: Date.parse("2026-11-18T12:00:00Z") };
		const book = new SignalBook(
			new MemoryStorage().document("signals.json"),
			() => clock.at,
		);
		return { clock, book };
	};

	it("answers the newest raise after a time, and none after the last", async () => {
		const { clock, book } = make();
		await book.raise("mdom.released", "a", { version: "1" });
		clock.at += HOUR;
		await book.raise("mdom.released", "b", { version: "2" });

		const since = new Date(clock.at - 3 * HOUR).toISOString();
		expect((await book.after("mdom.released", since))?.payload).toEqual({
			version: "2",
		});
		expect(
			await book.after("mdom.released", new Date(clock.at).toISOString()),
		).toBeNull();
		expect(await book.after("other/x", since)).toBeNull();
	});

	it("keeps raises a week and refuses a since further back", async () => {
		const { clock, book } = make();
		await book.raise("mdom.released", "a", null);
		clock.at += 8 * DAY;
		await book.raise("vexml/built", "a", null);

		expect(
			await book.after(
				"mdom.released",
				new Date(clock.at - HOUR).toISOString(),
			),
		).toBeNull();
		expect(
			book.after("mdom.released", new Date(clock.at - 8 * DAY).toISOString()),
		).rejects.toThrow("7 days");
	});

	it("reads a name as project and name", () => {
		expect(checkName(" mdom.released ")).toBe("mdom.released");
		expect(checkName("sound2score.deploy.ready")).toBe(
			"sound2score.deploy.ready",
		);
		expect(checkName("mdom/released")).toBe("mdom.released");
		expect(() => checkName("released")).toThrow("no signal name");
	});

	it("reads since as how long ago or a time", () => {
		const now = Date.parse("2026-11-18T12:00:00Z");
		expect(sinceOf("5h", now)).toBe("2026-11-18T07:00:00.000Z");
		expect(sinceOf("2026-11-17T00:00:00Z", now)).toBe(
			"2026-11-17T00:00:00.000Z",
		);
		expect(() => sinceOf("lately", now)).toThrow("no time");
	});
});
