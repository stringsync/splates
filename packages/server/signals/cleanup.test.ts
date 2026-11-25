import { describe, expect, it } from "bun:test";
import { MemoryStorage } from "../storage/testing";
import { SignalBook } from "./book";
import type { AutomationOn } from "./overview";
import { SignalRoutes } from "./routes";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("signal cleanup", () => {
	const make = (automations: AutomationOn[] = []) => {
		const clock = { at: Date.parse("2026-11-18T12:00:00Z") };
		const book = new SignalBook(
			new MemoryStorage().document("signals.json"),
			() => clock.at,
		);
		const routes = new SignalRoutes({
			book,
			all: async () => [],
			find: async () => null,
			rootOf: async () => null,
			automations: async () => automations,
			probes: {} as never,
			now: () => clock.at,
		});
		const shown = async () =>
			(
				(await (await routes.list()).json()) as {
					signals: { name: string }[];
				}
			).signals.map((each) => each.name);
		return { clock, book, routes, shown };
	};

	it("hides a signal idle for a day, and revive shows it again", async () => {
		const { clock, book, routes, shown } = make();
		await book.raise("mdom.released", "a", null);
		clock.at += 23 * HOUR;
		await book.raise("vexml.built", "a", null);
		clock.at += 2 * HOUR;

		expect(await routes.sweep()).toEqual(["mdom.released"]);
		expect(await shown()).toEqual(["vexml.built"]);
		expect(Object.keys(await book.swept())).toEqual(["mdom.released"]);
		const listed = (await (await routes.list()).json()) as {
			hidden: { name: string; at: string }[];
		};
		expect(listed.hidden.map((each) => each.name)).toEqual(["mdom.released"]);

		const revived = await routes.revive(
			new Request("http://x/api/signals/revive", {
				method: "POST",
				body: JSON.stringify({ name: "mdom.released" }),
			}),
		);
		expect(await revived.json()).toEqual({
			name: "mdom.released",
			revived: true,
		});
		expect(await shown()).toContain("mdom.released");
	});

	it("brings back a cleaned-up signal when it fires again", async () => {
		const { clock, book, routes, shown } = make();
		await book.raise("mdom.released", "a", null);
		clock.at += 2 * DAY;
		await routes.sweep();
		expect(await shown()).toEqual([]);

		await book.raise("mdom.released", "a", null);
		expect(await shown()).toEqual(["mdom.released"]);
	});

	it("keeps a signal a paused automation is on, not one a finished clock was on", async () => {
		const { clock, book, routes } = make([
			{
				project: "mono",
				id: "1",
				name: null,
				signal: "a.paused",
				paused: true,
			},
			{
				project: "mono",
				id: "2",
				name: null,
				signal: "a.done",
				paused: false,
				finished: true,
			},
		]);
		await book.raise("a.paused", "a", null);
		await book.raise("a.done", "a", null);
		clock.at += 2 * DAY;

		expect(await routes.sweep()).toEqual(["a.done"]);
	});

	it("forgets a cleaned-up signal after 30 days", async () => {
		const { clock, book } = make();
		await book.sweep([{ name: "mdom.released" }]);
		clock.at += 29 * DAY;
		expect(Object.keys(await book.swept())).toEqual(["mdom.released"]);
		clock.at += 2 * DAY;
		expect(await book.swept()).toEqual({});
		expect(await book.revive("mdom.released")).toBe(false);
	});
});
