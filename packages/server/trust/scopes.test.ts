import { describe, expect, it } from "bun:test";
import { FakeFs } from "core/system/testing";
import { FsStorage } from "../storage";
import { TrustRoutes } from "./routes";
import { TrustStore } from "./store";
import type { TrustDecision } from "./types";

describe("directory trust", () => {
	it("uses the deepest scope containing every changed path and respects directory boundaries", async () => {
		const store = trust();
		await store.addScope(KEY.project, "packages", START);
		await store.addScope(KEY.project, "packages/web/", START);
		await store.recordMany([
			decision("deep", {
				files: ["packages/web/test.ts", "packages/web/app.ts"],
			}),
			decision("parent", {
				files: ["packages/web/test.ts", "packages/website/test.ts"],
			}),
			decision("mixed", { files: ["packages/web/test.ts", "README.md"] }),
			decision("legacy"),
			decision("other-project", {
				project: "/elsewhere",
				files: ["packages/web/app.ts"],
			}),
		]);
		expect(
			(await store.decisions({ project: KEY.project, scope: DEEP.scope })).map(
				({ id }) => id,
			),
		).toEqual(["deep"]);
		expect((await store.entryFor(PARENT)).counts.total).toBe(1);
		expect((await store.entryFor(KEY)).counts.total).toBe(2);
		expect(
			(await store.entryFor({ ...KEY, project: "/elsewhere" })).counts.total,
		).toBe(1);
	});

	it("uses the final task diff for decisions answered before any edit", async () => {
		const store = trust();
		await store.addScope(KEY.project, DEEP.scope, START);
		const task = { task: "scope", conversation: "conv" };
		await store.record(decision("before-edits", task));
		const attempt = { task: task.task, project: KEY.project, startedAt: START };
		await store.rememberTaskFiles({ ...attempt, files: [], endedAt: null });
		expect((await store.entryFor(KEY)).counts.total).toBe(1);
		await store.rememberTaskFiles({
			...attempt,
			files: ["packages/web/app.ts"],
			endedAt: REMOVE,
		});
		await store.rememberTaskFiles({
			...attempt,
			files: ["README.md"],
			endedAt: null,
		});
		expect((await store.entryFor(DEEP)).counts.total).toBe(1);
		expect((await store.entryFor(KEY)).counts.total).toBe(0);
	});

	it("uses the scoped bucket in the widget and posture, including undone decisions", async () => {
		const store = trust();
		const task = { task: "scope", conversation: "conv" };
		await store.addScope(KEY.project, DEEP.scope, START);
		await store.setStatic(KEY, 40, START);
		await store.setStatic(DEEP, 95, START);
		await store.rememberTaskFiles({
			task: task.task,
			project: KEY.project,
			startedAt: START,
			endedAt: null,
			files: ["packages/web/app.ts"],
		});
		await store.record(decision("scoped", task));
		const bucket = await store.keyForFiles(
			KEY,
			["packages/web/app.ts"],
			ANSWER,
		);
		expect((await store.posture(bucket)).band).toBe("assume");
		expect(
			(await store.conversation(KEY, task.conversation, task.task)).entry.scope,
		).toBe(DEEP.scope);
		await store.setEffects(["scoped"], true);
		const undone = await store.conversation(KEY, task.conversation, task.task);
		expect(undone.entry.counts.total).toBe(0);
		expect(undone.decisions[0]).toMatchObject({
			scope: DEEP.scope,
			undone: true,
		});
		expect(undone.net).toBe(0);
		await store.setEffects(["scoped"], false);
		expect((await store.entryFor(DEEP)).counts.total).toBe(1);
	});

	it("keeps settings independent and routes future decisions away from removed scopes", async () => {
		const store = trust();
		await store.setStatic(KEY, 84, START);
		await store.addScope(KEY.project, " packages/web ", START);
		await store.record(decision("scoped", { files: ["packages/web/app.ts"] }));
		await store.setStatic(DEEP, 95, ANSWER);
		expect((await store.entryFor(KEY)).score).toBe(84);
		expect((await store.entryFor(DEEP)).score).toBe(95);
		await store.reset(DEEP, REMOVE);
		expect((await store.entryFor(DEEP)).mode).toBe("dynamic");
		expect((await store.entryFor(DEEP)).score).toBe(50);
		expect((await store.entryFor(DEEP)).counts.total).toBe(0);
		await store.removeScope(KEY.project, DEEP.scope, REMOVE);
		await store.record(
			decision("after-removal", { at: LATER, files: ["packages/web/app.ts"] }),
		);
		expect(await store.scopes()).toEqual([]);
		expect((await store.list()).map((each) => each.scope)).toEqual([undefined]);
		expect((await store.entryFor(KEY)).counts.total).toBe(1);
		expect(await store.decisions({ scope: DEEP.scope })).toHaveLength(1);
		expect(store.setStatic(DEEP, 90)).rejects.toThrow("no longer declared");
	});

	it("can manage scopes before a project has decision history", async () => {
		const routes = new TrustRoutes(trust());
		const request = (method: string, path: string) =>
			new Request("http://localhost/api/trust/scopes", {
				method,
				body: JSON.stringify({ project: KEY.project, path }),
			});
		expect(routes.changeScope(request("POST", "../outside"))).rejects.toThrow(
			"relative to the project",
		);
		const added = await routes.changeScope(request("POST", "packages/web"));
		expect(await added.json()).toEqual({
			entries: [],
			enabled: true,
			scopes: [{ project: KEY.project, path: DEEP.scope }],
		});
		const removed = await routes.changeScope(request("DELETE", DEEP.scope));
		expect(await removed.json()).toEqual({
			entries: [],
			enabled: true,
			scopes: [],
		});
	});
});

const START = "2026-11-25T20:00:00.000Z";
const ANSWER = "2026-11-25T20:01:00.000Z";
const REMOVE = "2026-11-25T20:02:00.000Z";
const LATER = "2026-11-25T20:03:00.000Z";
const KEY = { project: "/repo", agent: "codex", model: null };
const DEEP = { ...KEY, scope: "packages/web/" };
const PARENT = { ...KEY, scope: "packages/" };

function trust() {
	return new TrustStore(new FsStorage("/machine", new FakeFs()));
}

function decision(
	id: string,
	fields: Partial<TrustDecision> = {},
): TrustDecision {
	return {
		...KEY,
		id,
		at: ANSWER,
		kind: "defaults",
		source: "question",
		outcome: "kept",
		subject: "Keep the default?",
		conversation: null,
		task: null,
		...fields,
	};
}
