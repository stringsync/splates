import type { AgentPick } from "../models";
import {
	ROUTE_DEPTHS,
	ROUTE_KINDS,
	type RouteDepth,
	type RouteKind,
} from "./cells";
import { DEFAULT_RULES } from "./defaults";
import type { AutoPickRules, Routes } from "./rules";
import type { Judge, Judgment, Verdict } from "./system-one";

/** A fetch that answers `body` with `status`, recording each request. */
export function serve(body: unknown, status = 200) {
	const requests: { url: string; init: RequestInit }[] = [];
	const fetch = (async (url: string, init: RequestInit) => {
		requests.push({ url, init });
		return new Response(JSON.stringify(body), { status });
	}) as unknown as typeof globalThis.fetch;
	return { fetch, requests };
}

/** A judge that answers every judgment with `answers`, recording each it was asked. */
export class FakeJudge implements Judge {
	readonly asked: Judgment[] = [];

	constructor(
		private readonly answers: Record<string, number> = {},
		/** What it says each judgment cost; it says no price when not given. */
		private readonly dollars?: number,
	) {}

	async judge(judgment: Judgment): Promise<Verdict> {
		this.asked.push(judgment);
		return {
			answers: new Map(Object.entries(this.answers)),
			...(this.dollars === undefined ? {} : { dollars: this.dollars }),
		};
	}
}

/**
 * Rules sending every cell to one lineup, `All` unless `id` names it, of
 * `picks`, at the default threshold and pace.
 */
export function routedTo(picks: AgentPick[], id = "all"): AutoPickRules {
	return {
		...DEFAULT_RULES,
		lineups: [
			{
				id,
				name: id.charAt(0).toUpperCase() + id.slice(1),
				color: "sky",
				picks,
			},
		],
		routes: Object.fromEntries(
			ROUTE_KINDS.map((kind) => [
				kind,
				Object.fromEntries(ROUTE_DEPTHS.map((depth) => [depth, id])),
			]),
		) as Routes,
	};
}

/** `rules` with `kind` at `depth` sent to a new lineup `name` of `picks`. */
export function withCell(
	rules: AutoPickRules,
	kind: RouteKind,
	depth: RouteDepth,
	name: string,
	picks: AgentPick[],
): AutoPickRules {
	const id = name.toLowerCase();
	return {
		...rules,
		lineups: [...rules.lineups, { id, name, color: "pink", picks }],
		routes: {
			...rules.routes,
			[kind]: { ...rules.routes[kind], [depth]: id },
		},
	};
}
