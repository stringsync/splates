import { describe, expect, it } from "bun:test";
import type { AutomationRow } from "@stringsync/splates-server/hooks";
import { AutomationList, type AutomationsApi } from "./automation-list";

describe("AutomationList", () => {
	it("holds a pause and a remove pending, showing the server's rows until it answers", async () => {
		const { api, settle } = held([TIDY]);
		const list = new AutomationList(api);
		await list.read();

		const pausing = list.pause(TIDY, true);
		expect(list.own[0]?.paused).toBeUndefined();
		expect(list.isPending("1")).toBe(true);
		settle();
		expect(await pausing).toBe(true);
		expect(list.own[0]?.paused).toBe(true);
		expect(list.isPending("1")).toBe(false);

		const removing = list.remove(TIDY);
		expect(list.own).toHaveLength(1);
		settle();
		await removing;
		expect(list.own).toEqual([]);
	});

	it("lists a run by hand only once the server answers", async () => {
		const { api, settle } = held([TIDY]);
		const list = new AutomationList(api);
		await list.read();

		const running = list.run(TIDY);
		expect(list.own[0]?.runs).toEqual([]);
		settle();
		expect(await running).toBe(true);
		expect(list.own[0]?.runs.map(({ at }) => at)).toEqual([
			"2026-10-23T09:00:00.000Z",
		]);
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

	it("holds an edit pending, then shows what the server says it now is", async () => {
		const { api, settle } = held([TIDY]);
		const list = new AutomationList(api);
		await list.read();

		const editing = list.edit(TIDY, { every: "2h" }, TIDY.hook);
		expect(list.own[0]).toMatchObject({ trigger: { every: "1h" } });
		expect(list.isPending("1")).toBe(true);
		settle();
		expect(await editing).toBe(true);

		expect(list.own[0]).toMatchObject({ id: "1", when: "every 2h" });
	});

	it("holds the groomer pending until the server says it stands", async () => {
		const { api, settle } = held([TIDY]);
		const list = new AutomationList(api);
		await list.read();
		expect(list.groomer).toBeNull();

		const turning = list.groom({ agent: "claude" });
		expect(list.groomer).toBeNull();
		expect(list.isPending("groomer")).toBe(true);
		settle();
		expect(await turning).toBe(true);
		expect(list.groomer).toMatchObject({ when: "task.created in backlog" });

		const editing = list.groom({ agent: "codex", model: "gpt-5" });
		expect(list.groomer).toMatchObject({ hook: { agent: "claude" } });
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
		run: () =>
			write([
				{
					...TIDY,
					runs: [
						{ at: "2026-10-23T09:00:00.000Z", on: "by hand", error: null },
					],
				},
			]),
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
	};
	return { api, settle: (refused?: Error) => settle(refused) };
}
