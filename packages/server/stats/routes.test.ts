import { expect, it } from "bun:test";
import { FakeFs, FakePs } from "core/system/testing";
import { splatesHome } from "../models";
import { FsStorage } from "../storage";
import { DevOutcomes } from "./routes";

it("dismisses only the history shown, even after a restart or a stale dismissal", async () => {
	const deps = { fs: new FakeFs(), ps: new FakePs() };
	const routes = new DevOutcomes(deps);
	const log = new FsStorage(splatesHome(deps.ps), deps.fs).log(
		"outcomes.jsonl",
	);
	const record = (kind: string) =>
		log.append({
			endedAt: "2020-01-01T00:00:00.000Z",
			overrides: [{ kind, depth: "deep" }],
		});
	const request = new Request(
		"http://localhost/api/auto-pick/overrides?view=notice",
	);
	const dismiss = (cursor: number) =>
		routes.dismissOverrides(
			new Request(request.url, {
				method: "POST",
				body: JSON.stringify({ cursor }),
			}),
		);
	await record("design");
	const shown = await routes.overrides(request);
	await record("bugfix");
	await dismiss(Number(shown.headers.get("X-Override-Cursor")));
	const restarted = new DevOutcomes(deps);
	expect(
		(await (await restarted.overrides(request)).json()).map(
			(row: { kind: string }) => row.kind,
		),
	).toEqual(["bugfix"]);
	await dismiss(2);
	await dismiss(1);
	expect(await (await restarted.overrides(request)).json()).toEqual([]);
	const history = await restarted.overrides(
		new Request("http://localhost/api/auto-pick/overrides"),
	);
	expect(await history.json()).toHaveLength(2);
	const scorecard = (period: string) =>
		restarted.scorecard(
			new Request(`http://localhost/api/auto-pick/scorecard?period=${period}`),
		);
	expect(await (await scorecard("7d")).json()).toMatchObject({
		rows: [],
		overrides: [],
	});
	expect(await (await scorecard("all")).json()).toMatchObject({
		rows: [],
		overrides: [
			{ kind: "design", lineup: null, earlier: 1 },
			{ kind: "bugfix", lineup: null, earlier: 1 },
		],
	});
});
