import { describe, expect, it } from "bun:test";
import { Testing } from "../testing";
import { deferralBlockers } from "./deferral";
import {
	type ElsewhereBoards,
	ElsewhereStanding,
	type ElsewhereTask,
} from "./elsewhere";
import { ElsewhereLinks } from "./elsewhere-links";

const WIZ = "/repos/webappwiz";

describe("blockers in other projects", () => {
	it("links them, keeps them once, and unlinks them", async () => {
		await using deps = await Testing.open();
		const locale = {
			project: WIZ,
			id: 404,
			subject: "format() takes a locale",
		};
		const task = await deps.tasks.add("Show prices by locale", null, {
			blockedElsewhere: [locale, locale],
		});

		expect(task.blockedElsewhere).toEqual([locale]);

		const relinked = await task.update({
			blockedElsewhere: [locale, { project: WIZ, id: 405, subject: "dates" }],
		});
		expect(relinked.blockedElsewhere.map((each) => each.id)).toEqual([
			404, 405,
		]);

		const unlinked = await relinked.update({ blockedElsewhere: [] });
		expect(unlinked.state.blockedElsewhere).toBeUndefined();
	});

	it("notes each that merged or left without merging there", async () => {
		await using deps = await Testing.open();
		const there = new Map<number, ElsewhereTask>([
			[1, { status: "queued", subject: "a", lane: null, takenBy: null }],
		]);
		const boards = fakeBoards(there);
		const task = await deps.tasks.add("Waits on webappwiz", null, {
			blockedElsewhere: [1, 2, 3].map((id) => ({
				project: WIZ,
				id,
				subject: `wiz ${id}`,
			})),
		});
		there.set(2, { status: "merged", commit: "abc123" });
		there.set(3, { status: "removed" });

		const changed = await new ElsewhereLinks(deps.tasks).settle(boards);

		expect(changed.map((each) => each.id)).toEqual([task.id]);
		const now = await deps.tasks.find(task.id);
		expect(now.blockedElsewhere).toEqual([
			{ project: WIZ, id: 1, subject: "wiz 1" },
			{ project: WIZ, id: 2, subject: "wiz 2", landed: "abc123" },
			{ project: WIZ, id: 3, subject: "wiz 3", lost: true },
		]);
		expect(
			(await new ElsewhereStanding(boards).of(now.state)).map(
				(each) => each.status,
			),
		).toEqual(["queued", "merged", "removed"]);
		// Nothing more to note, nothing changes.
		expect(await new ElsewhereLinks(deps.tasks).settle(boards)).toEqual([]);
	});

	it("follows a deferral's blocker in another project", async () => {
		await using deps = await Testing.open();
		const boards = fakeBoards(
			new Map([
				[404, { status: "working", subject: "a", lane: 2, takenBy: "x" }],
			]),
		);
		const deferred = await deps.tasks.add("Retry on 413", null);
		await deferred.defer(
			{
				why: "Needs the locale change in webappwiz.",
				blockedBy: [],
				blockedElsewhere: [{ project: WIZ, id: 404, subject: "locale" }],
				questions: [],
				outside: [],
			},
			{ task: "alpha" },
		);
		const state = (await deps.tasks.find(deferred.id)).state;

		expect(
			deferralBlockers(
				state,
				[state],
				await new ElsewhereStanding(boards).of(state),
			),
		).toEqual([
			{
				kind: "task",
				id: 404,
				subject: "locale",
				project: WIZ,
				slug: "webappwiz",
				status: "working",
			},
		]);
	});
});

/** Another project's board as `there` holds it, by task number. */
function fakeBoards(there: Map<number, ElsewhereTask>): ElsewhereBoards {
	return {
		root: async (slug) => (slug === "webappwiz" ? WIZ : null),
		slug: async () => "webappwiz",
		find: async (_root, id) => there.get(id) ?? null,
		following: async () => [],
	};
}
