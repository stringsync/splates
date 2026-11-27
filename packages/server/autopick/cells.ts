import {
	DEPTH_IDS,
	DEPTHS,
	type DepthId,
	KIND_IDS,
	KINDS,
	type KindId,
} from "./classes";

// Browser-safe: the page draws the routes from here, through `./browser`.

/** The rules' own format. */
export const RULES_FORMAT = 3;

/** A kind or depth the judge was not sure enough of. */
export const UNSURE = "unsure" as const;

/** A row of the routes: a kind, or `unsure`. */
export type RouteKind = KindId | typeof UNSURE;
/** A column of the routes: a depth, or `unsure`. */
export type RouteDepth = DepthId | typeof UNSURE;

/** The routes' rows, top to bottom: each kind, then unsure. */
export const ROUTE_KINDS: readonly RouteKind[] = [...KIND_IDS, UNSURE];
/** The routes' columns, left to right: unsure, then each depth. */
export const ROUTE_DEPTHS: readonly RouteDepth[] = [UNSURE, ...DEPTH_IDS];

/** The colors a lineup can take, in the order new lineups take them. */
export const LINEUP_COLORS = [
	"emerald",
	"sky",
	"violet",
	"pink",
	"red",
	"amber",
	"slate",
] as const;
export type LineupColor = (typeof LINEUP_COLORS)[number];

/** The pace a mapping without one takes. */
export const DEFAULT_PACE = { on: true, slack: 0.1, spent: 0.95 } as const;

/** The holdout a mapping without one takes: off, a tenth of tasks once on. */
export const DEFAULT_HOLDOUT = { on: false, share: 0.1 } as const;

/** A kind's name: `Bugfix`, or `Unsure` for none. */
export function kindLabel(kind: RouteKind | null): string {
	return kind === null || kind === UNSURE
		? "Unsure"
		: (KINDS.find((each) => each.id === kind)?.label ?? kind);
}

/** A depth's name: `Deep`, or `Unsure` for none. */
export function depthLabel(depth: RouteDepth | null): string {
	return depth === null || depth === UNSURE
		? "Unsure"
		: (DEPTHS.find((each) => each.id === depth)?.label ?? depth);
}

/** A cell in words: `Bugfix · Deep`. */
export function cellLabel(
	kind: RouteKind | null,
	depth: RouteDepth | null,
): string {
	return `${kindLabel(kind)} · ${depthLabel(depth)}`;
}

/** An id for a lineup named `name`, none of `lineups` has. */
export function idFor(
	name: string,
	lineups: readonly { id: string }[],
): string {
	const base =
		name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "") || "lineup";
	let at = 1;
	let candidate = base;
	while (lineups.some((each) => each.id === candidate)) {
		at += 1;
		candidate = `${base}-${at}`;
	}
	return candidate;
}
