import { beforeEach, describe, expect, it } from "bun:test";
import { FakeFs } from "core/system/testing";
import { conversation, message } from "../fixtures";
import type { Git } from "../git";
import { FsStorage } from "../storage";
import { TrustRoutes } from "./routes";
import { TrustStore } from "./store";

const AT = "2026-11-25T20:00:00.000Z";

describe("TrustStore & TrustRoutes", () => {
	let fs: FakeFs;
	let store: TrustStore;

	beforeEach(() => {
		fs = new FakeFs();
		store = new TrustStore(new FsStorage("/home/.splates", fs));
	});

	it("deduplicates repeated observations of the same conversation", async () => {
		const state = conversation({
			id: "c1",
			agent: "claude",
			settings: [
				{
					id: "model",
					name: "Model",
					type: "select",
					category: "model",
					current: "opus",
					options: [{ value: "opus", name: "Opus 4.6", description: null }],
				},
			],
			messages: [
				message(
					"agent",
					"1. Keep old route?\n   - (a) Yes (chosen)\n   - (b) No",
				),
				message("user", "> **Keep old route?**\n\n- (a) Yes"),
			],
		});

		expect(await store.observeConversation(state, "/repo", AT)).toBe(1);
		expect(await store.observeConversation(state, "/repo", AT)).toBe(0);
		expect((await store.decisions()).length).toBe(1);
	});

	it("restores the same scores after undo, replay, and repeated redo", async () => {
		const key = { project: "/repo", agent: "claude", model: null };
		await store.recordRedo({
			...key,
			task: "first",
			conversation: "c1",
			at: AT,
		});
		await store.recordUnaskedOverturn({
			...key,
			subject: "second",
			conversation: "c2",
			at: "2026-11-26",
		});
		const original = await store.conversation(key, "c1");
		const ids = original.decisions.map((decision) => decision.id);
		const routes = new TrustRoutes(store);
		const update = (undone: boolean) =>
			routes.setEffects(
				new Request("http://localhost/api/trust/decisions", {
					method: "PUT",
					body: JSON.stringify({ ids, undone }),
				}),
			);
		await update(true);
		await update(true);
		const reopened = new TrustStore(new FsStorage("/home/.splates", fs));
		const changed = await reopened.conversation(key, "c1");
		expect(changed.net).toBe(0);
		expect(changed.entry.counts.total).toBe(1);
		expect(changed.decisions[0]?.undone).toBe(true);
		expect(changed.decisions[0]?.delta).toBe(original.net);
		await update(false);
		await update(false);
		expect(await reopened.conversation(key, "c1")).toEqual(original);
	});

	it("records redo removals, unasked overturns, and post-merge git reverts", async () => {
		await store.recordRedo({
			project: "/repo",
			agent: "claude",
			model: "Opus 4.6",
			task: "bad-task",
			conversation: "c1",
			at: AT,
		});
		await store.recordUnaskedOverturn({
			project: "/repo",
			agent: "claude",
			model: "Opus 4.6",
			subject: "retry limit 3; 5 is the alternative",
			at: "2026-11-25T20:01:00.000Z",
		});

		const fakeGit = {
			run: async () => ({
				code: 0,
				stdout:
					'deadbeef1234\x1fRevert "Add widget"\x1fThis reverts commit abcdef123456.\x1e',
				stderr: "",
			}),
		} as unknown as Git;

		const added = await store.scanReverts(
			fakeGit,
			"/repo",
			[
				{
					task: "widget",
					commit: "abcdef1234567890",
					agent: "claude",
					model: "Opus 4.6",
					subject: "Add widget",
				},
			],
			{ at: "2026-11-25T20:02:00.000Z" },
		);
		expect(added).toBe(1);
		// Second scan deduplicates by revert commit SHA.
		expect(
			await store.scanReverts(
				fakeGit,
				"/repo",
				[
					{
						task: "widget",
						commit: "abcdef1234567890",
						agent: "claude",
						model: "Opus 4.6",
					},
				],
				{ at: "2026-11-25T20:03:00.000Z" },
			),
		).toBe(0);

		const all = await store.decisions({ project: "/repo" });
		expect(all.map((decision) => decision.source).sort()).toEqual([
			"redo",
			"revert",
			"unasked",
		]);
	});

	it("supports band overrides, auto mode, reset, and legacy 0–100 migration via store and HTTP routes", async () => {
		const routes = new TrustRoutes(store);
		const putStatic = await routes.update(
			new Request("http://localhost/api/trust", {
				method: "PUT",
				body: JSON.stringify({
					project: "/repo",
					agent: "claude",
					model: "Opus 4.6",
					mode: "static",
					band: "ask-and-go",
				}),
			}),
		);
		expect(putStatic.status).toBe(200);
		const staticBody = (await putStatic.json()) as {
			entry: {
				band: string;
				earnedBand: string;
				mode: string;
				pinnedBand: string;
			};
			setting: { mode: string; band: string };
		};
		expect(staticBody.entry.band).toBe("ask-and-go");
		expect(staticBody.entry.earnedBand).toBe("ask-and-wait");
		expect(staticBody.entry.mode).toBe("static");
		expect(staticBody.entry.pinnedBand).toBe("ask-and-go");
		expect(staticBody.setting.band).toBe("ask-and-go");

		const putDynamic = await routes.update(
			new Request("http://localhost/api/trust", {
				method: "PUT",
				body: JSON.stringify({
					project: "/repo",
					agent: "claude",
					model: "Opus 4.6",
					mode: "dynamic",
				}),
			}),
		);
		const dynamicBody = (await putDynamic.json()) as {
			entry: { mode: string; band: string; earnedBand: string };
		};
		expect(dynamicBody.entry.mode).toBe("dynamic");
		expect(dynamicBody.entry.band).toBe("ask-and-wait");
		expect(dynamicBody.entry.earnedBand).toBe("ask-and-wait");

		const putReset = await routes.update(
			new Request("http://localhost/api/trust", {
				method: "PUT",
				body: JSON.stringify({
					project: "/repo",
					agent: "claude",
					model: "Opus 4.6",
					reset: true,
				}),
			}),
		);
		const resetBody = (await putReset.json()) as {
			entry: {
				mode: string;
				band: string;
				pinnedBand: string | null;
				standing: { sessions: number };
			};
		};
		expect(resetBody.entry.mode).toBe("dynamic");
		expect(resetBody.entry.band).toBe("ask-and-wait");
		expect(resetBody.entry.pinnedBand).toBeNull();
		expect(resetBody.entry.standing.sessions).toBe(0);

		const listRes = await routes.list(
			new Request("http://localhost/api/trust?project=/repo"),
		);
		const listed = (await listRes.json()) as { entries: unknown[] };
		expect(listed.entries).toHaveLength(1);

		const postDecision = await routes.record(
			new Request("http://localhost/api/trust/decisions", {
				method: "POST",
				body: JSON.stringify({
					project: "/repo",
					agent: "claude",
					model: "Opus 4.6",
					kind: "defaults",
					source: "unasked",
					outcome: "overturned",
					subject: "timeout 5s",
				}),
			}),
		);
		expect(
			((await postDecision.json()) as { recorded: boolean }).recorded,
		).toBe(true);

		const decisionsRes = await routes.decisions(
			new Request("http://localhost/api/trust/decisions?project=/repo"),
		);
		const decBody = (await decisionsRes.json()) as { decisions: unknown[] };
		expect(decBody.decisions).toHaveLength(1);
	});

	it("migrates legacy numeric static settings transparently on read and save", async () => {
		const lowKey = { project: "/repo", agent: "claude", model: "Haiku" };
		const midKey = { project: "/repo", agent: "claude", model: "Sonnet" };
		const highKey = { project: "/repo", agent: "claude", model: "Opus" };
		await fs.write(
			"/home/.splates/trust-settings.json",
			JSON.stringify({
				settings: {
					"/repo\0claude\0Haiku": {
						...lowKey,
						mode: "static",
						value: 60,
						dynamicBase: 65,
						dynamicAt: AT,
						resetAt: null,
						updatedAt: AT,
					},
					"/repo\0claude\0Sonnet": {
						...midKey,
						mode: "static",
						value: 80,
						resetAt: null,
						updatedAt: AT,
					},
					"/repo\0claude\0Opus": {
						...highKey,
						mode: "static",
						value: 95,
						resetAt: null,
						updatedAt: AT,
					},
				},
			}),
		);

		const reopened = new TrustStore(new FsStorage("/home/.splates", fs));
		expect((await reopened.entryFor(lowKey)).band).toBe("ask-and-wait");
		expect((await reopened.entryFor(midKey)).band).toBe("ask-and-go");
		expect((await reopened.entryFor(highKey)).band).toBe("assume");

		// Saving an update persists the clean band format without legacy numeric fields.
		await reopened.setDynamic(lowKey, "2026-11-26T00:00:00.000Z");
		const saved = JSON.parse(
			await fs.read("/home/.splates/trust-settings.json"),
		) as { settings: Record<string, Record<string, unknown>> };
		const savedLow = saved.settings["/repo\0claude\0Haiku"];
		expect(savedLow?.band).toBe("ask-and-wait");
		expect(savedLow?.mode).toBe("dynamic");
		expect("value" in (savedLow ?? {})).toBe(false);
		expect("dynamicBase" in (savedLow ?? {})).toBe(false);
		expect("dynamicAt" in (savedLow ?? {})).toBe(false);
	});

	it("returns pending rule suggestions filtered by project", async () => {
		const routes = new TrustRoutes(
			store,
			async () => false,
			async (project) =>
				[
					{
						project: "/repo",
						slug: "repo",
						taskId: 42,
						subject: "Write down a rule for: Where should export live?",
						createdAt: AT,
						corrections: [],
					},
					{
						project: "/other",
						slug: "other",
						taskId: 7,
						subject: "Write down a rule for: Use tabs?",
						createdAt: AT,
						corrections: [],
					},
				].filter((each) => project === undefined || each.project === project),
		);
		const allRes = await routes.suggestions(
			new Request("http://localhost/api/trust/suggestions"),
		);
		expect(
			((await allRes.json()) as { suggestions: unknown[] }).suggestions,
		).toHaveLength(2);
		const oneRes = await routes.suggestions(
			new Request("http://localhost/api/trust/suggestions?project=/repo"),
		);
		const one = (await oneRes.json()) as {
			suggestions: { taskId: number }[];
		};
		expect(one.suggestions.map((each) => each.taskId)).toEqual([42]);
	});
});
