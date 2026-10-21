import { describe, expect, it } from "bun:test";
import type { AutomationRow } from "@stringsync/splates-server/hooks";
import { AutomationList, type AutomationsApi } from "./automation-list";

describe("AutomationList", () => {
	it("shows a pause and a remove at once, before the server answers", async () => {
		const { api, settle } = held([TIDY]);
		const list = new AutomationList(api);
		await list.read();

		const pausing = list.pause(TIDY, true);
		expect(list.own[0]?.paused).toBe(true);
		settle();
		expect(await pausing).toBe(true);

		const removing = list.remove(TIDY);
		expect(list.own).toEqual([]);
		settle();
		await removing;
	});

	it("shows one being added, then the one the server numbered", async () => {
		const { api, settle } = held([TIDY]);
		const list = new AutomationList(api);
		await list.read();

		const adding = list.add({ every: "2h" }, { kind: "run", command: "x" });
		expect(list.own.map(({ id }) => id)).toEqual(["1", ""]);
		settle();
		await adding;

		expect(list.own.map(({ id }) => id)).toEqual(["1", "2"]);
	});

	it("shows an edit being saved, then what the server says it now is", async () => {
		const { api, settle } = held([TIDY]);
		const list = new AutomationList(api);
		await list.read();

		const editing = list.edit(TIDY, { every: "2h" }, TIDY.hook);
		expect(list.own[0]).toMatchObject({ trigger: { every: "2h" }, when: "" });
		settle();
		expect(await editing).toBe(true);

		expect(list.own[0]).toMatchObject({ id: "1", when: "every 2h" });
	});

	it("shows the groomer turned on at once, then edited, as the server says it stands", async () => {
		const { api, settle } = held([TIDY]);
		const list = new AutomationList(api);
		await list.read();
		expect(list.groomer).toBeNull();

		const turning = list.groom({ agent: "claude" });
		expect(list.builtIn).toMatchObject([
			{ id: "groomer", hook: { kind: "groom", agent: "claude" }, when: "" },
		]);
		settle();
		expect(await turning).toBe(true);
		expect(list.groomer).toMatchObject({ when: "task.created in backlog" });

		const editing = list.groom({ agent: "codex", model: "gpt-5" });
		expect(list.builtIn).toMatchObject([
			{ hook: { kind: "groom", agent: "codex", model: "gpt-5" }, when: "" },
		]);
		settle();
		await editing;
	});

	it("shows the notes gardener turned on at once, on the schedule picked, as the server says it stands", async () => {
		const { api, settle } = held([TIDY]);
		const list = new AutomationList(api);
		await list.read();
		expect(list.notesGardener).toBeNull();

		const turning = list.gardener({ agent: "claude" }, { every: "7d" });
		expect(list.builtIn).toMatchObject([
			{
				id: "notes-gardener",
				trigger: { every: "7d" },
				hook: { kind: "garden", agent: "claude" },
				when: "",
			},
		]);
		settle();
		expect(await turning).toBe(true);
		expect(list.notesGardener).toMatchObject({ when: "every 7d" });

		const editing = list.gardener({ agent: "claude" }, { cron: "0 9 * * 1" });
		expect(list.notesGardener).toMatchObject({
			trigger: { cron: "0 9 * * 1" },
			when: "",
		});
		settle();
		await editing;
	});

	it("says a refusal and goes back to what stands", async () => {
		const { api, settle } = held([TIDY]);
		const list = new AutomationList(api);
		await list.read();

		const removing = list.remove(TIDY);
		settle(new Error("no automation 1"));

		expect(await removing).toBe(false);
		expect(list.refusal).toBe("Not removed: no automation 1");
		expect(list.own).toEqual([TIDY]);
	});
});

const TIDY: AutomationRow = {
	id: "1",
	trigger: { every: "1h" },
	hook: { kind: "run", command: "tidy" },
	createdAt: "2026-10-19T00:00:00.000Z",
	when: "every 1h",
	does: "run `tidy`",
	runs: [],
};

/** An api answering from `rows`, holding each write until `settle` lets it go. */
function held(rows: AutomationRow[]) {
	let settle: (refused?: Error) => void = () => {};
	const write = (after: AutomationRow[]) =>
		new Promise<AutomationRow[]>((resolve, reject) => {
			settle = (refused) => (refused ? reject(refused) : resolve(after));
		});
	const api: AutomationsApi = {
		read: async () => rows,
		add: () => write([...rows, { ...TIDY, id: "2" }]),
		edit: (_, trigger) => write([{ ...TIDY, trigger, when: "every 2h" }]),
		remove: () => write([]),
		pause: () => write([{ ...TIDY, paused: true }]),
		groom: (pick) =>
			write([
				TIDY,
				{
					...TIDY,
					id: "groomer",
					trigger: { event: "task.created", filter: { stages: ["backlog"] } },
					hook: { kind: "groom", ...pick },
					source: "builtin",
					when: "task.created in backlog",
					does: `groom the backlog with ${pick.agent}`,
				},
			]),
		gardener: (pick, schedule) =>
			write([
				TIDY,
				{
					...TIDY,
					id: "notes-gardener",
					trigger: schedule,
					hook: { kind: "garden", ...pick },
					source: "builtin",
					when: "every" in schedule ? `every ${schedule.every}` : "cron",
					does: `tend the project notes with ${pick.agent}`,
				},
			]),
	};
	return { api, settle: (refused?: Error) => settle(refused) };
}
