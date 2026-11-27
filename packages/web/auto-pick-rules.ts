import type {
	AutoPickAgent,
	AutoPickRules,
	AutoPickRulesView,
	Holdout,
	Lineup,
	LineupColor,
	Pace,
	RouteDepth,
	RouteKind,
} from "@splates/server/auto-pick";
import {
	cellLabel,
	DEFAULT_HOLDOUT,
	DEFAULT_PACE,
	DEFAULT_RULES,
	LINEUP_COLORS,
	ROUTE_DEPTHS,
	ROUTE_KINDS,
} from "@splates/server/auto-pick/browser";
import { checkRules, idFor, planOf } from "@splates/server/auto-pick/check";
import type { AgentPick } from "@splates/server/models";
import { Dispatcher, type Eventful } from "core/events";
import {
	autoPickRules,
	resetAutoPickRules,
	saveAutoPickRules,
} from "./auto-pick-api";

/** Where the editor reads and writes the machine's rules. */
export interface RulesStore {
	read(): Promise<AutoPickRulesView>;
	save(rules: AutoPickRules): Promise<AutoPickRulesView>;
	reset(): Promise<AutoPickRulesView>;
}

export type RulesEditorEvents = { changed: undefined };

/** The thinking levels offered for an agent that has not said which it takes. */
export const EFFORTS = ["low", "medium", "high"];

/** One cell of the routes: a kind at a depth, either of them unsure. */
export interface Cell {
	kind: RouteKind;
	depth: RouteDepth;
}

/** Every cell, row by row. */
export const CELLS: readonly Cell[] = ROUTE_KINDS.flatMap((kind) =>
	ROUTE_DEPTHS.map((depth) => ({ kind, depth })),
);

/** A cell as one string, for keys and sets: `bugfix.deep`. */
export function cellKey({ kind, depth }: Cell): string {
	return `${kind}.${depth}`;
}

/** The cell a pick was made for, as `cellKey` writes it; unsure where null. */
export function pickedCell(picked: {
	kind: string | null;
	depth: string | null;
}): string {
	return `${picked.kind ?? "unsure"}.${picked.depth ?? "unsure"}`;
}

/** A cell key in words: `Bugfix · Deep`. */
export function cellKeyLabel(key: string): string {
	const [kind = "unsure", depth = "unsure"] = key.split(".");
	return cellLabel(kind as RouteKind, depth as RouteDepth);
}

/**
 * Use this to edit Auto pick's lineups and routes through `draft` and its
 * setters. Call `load` first, subscribe to `events` for changes, and call
 * `save` or `reset` to write. Every cell keeps a lineup, so a lineup in use
 * is not deleted, and a lineup keeps at least one pick.
 */
export class RulesEditor implements Eventful<RulesEditorEvents> {
	private readonly dispatcher = new Dispatcher<RulesEditorEvents>();
	readonly events = this.dispatcher.events;

	/** The rules as edited, the saved ones until a control moves. */
	draft: AutoPickRules = DEFAULT_RULES;
	/** The rules the server holds, as far as the page knows; null before the first read. */
	saved: AutoPickRules | null = null;
	/** The roster's agents a pick can name. */
	agents: readonly AutoPickAgent[] = [];
	/** Why the file did not read, so saving replaces it; null when it read. */
	fileProblem: string | null = null;
	/** Why the rules could not be read at all; null once they were, or before. */
	loadProblem: string | null = null;
	/** Whether a save is still waiting on the server. */
	saving = false;

	constructor(private readonly store: RulesStore = HTTP_RULES) {}

	/** Whether the draft differs from what the server holds. */
	get dirty(): boolean {
		return (
			this.saved !== null &&
			JSON.stringify(this.draft) !== JSON.stringify(this.saved)
		);
	}

	/** What does not check out in the draft, in one line, or null. */
	get problem(): string | null {
		const checked = checkRules(this.draft);
		return checked.ok ? null : checked.problem;
	}

	/** The confidence threshold, as a whole percent. */
	get percent(): number {
		return Math.round(this.draft.threshold * 100);
	}

	/** When a pick's plan counts as used too fast, the defaults' when the rules name none. */
	get pace(): Pace {
		return this.draft.pace ?? DEFAULT_PACE;
	}

	/** Whether a share of tasks starts one difficulty easier, the default's when the rules name none. */
	get holdout(): Holdout {
		return this.draft.holdout ?? DEFAULT_HOLDOUT;
	}

	/** Reads the rules, unless they were read already. */
	async load(): Promise<void> {
		if (this.saved !== null) {
			return;
		}
		try {
			this.take(await this.store.read());
			this.loadProblem = null;
		} catch (error) {
			this.loadProblem = error instanceof Error ? error.message : String(error);
		}
		this.changed();
	}

	setPercent(percent: number): void {
		if (Number.isFinite(percent)) {
			const clamped = Math.min(100, Math.max(0, Math.round(percent)));
			this.edit((rules) => ({ ...rules, threshold: clamped / 100 }));
		}
	}

	setPaced(on: boolean): void {
		this.edit((rules) => ({ ...rules, pace: { ...this.pace, on } }));
	}

	/** How far use may run ahead of a window's time, as a whole percent. */
	setSlackPercent(percent: number): void {
		this.editPace("slack", percent);
	}

	/** How much of a window a pick may use at all, as a whole percent. */
	setSpentPercent(percent: number): void {
		this.editPace("spent", percent);
	}

	setHeldOut(on: boolean): void {
		this.edit((rules) => ({ ...rules, holdout: { ...this.holdout, on } }));
	}

	/** The share of tasks held out, as a whole percent. */
	setHoldoutPercent(percent: number): void {
		if (Number.isFinite(percent)) {
			const clamped = Math.min(100, Math.max(0, Math.round(percent)));
			this.edit((rules) => ({
				...rules,
				holdout: { ...this.holdout, share: clamped / 100 },
			}));
		}
	}

	/** The lineup with `id`, if the draft has it. */
	lineup(id: string): Lineup | undefined {
		return this.draft.lineups.find((each) => each.id === id);
	}

	/** The lineup `cell` sends its tasks to. */
	lineupOf(cell: Cell): Lineup | undefined {
		return this.lineup(this.draft.routes[cell.kind][cell.depth]);
	}

	/** The cells sending their tasks to lineup `id`. */
	uses(id: string): Cell[] {
		return CELLS.filter(
			(cell) => this.draft.routes[cell.kind][cell.depth] === id,
		);
	}

	/** Sends `cells` to lineup `id`. */
	send(cells: readonly Cell[], id: string): void {
		if (this.lineup(id) === undefined || cells.length === 0) {
			return;
		}
		this.edit((rules) => {
			const routes = structuredClone(rules.routes);
			for (const cell of cells) {
				routes[cell.kind][cell.depth] = id;
			}
			return { ...rules, routes };
		});
	}

	/**
	 * Adds a lineup, named `New lineup` (or `New lineup 2` and on), in the
	 * first color no lineup takes, picking the roster's first agent; returns
	 * its id.
	 */
	addLineup(): string {
		const taken = (name: string) =>
			this.draft.lineups.some(
				(each) => each.name.toLowerCase() === name.toLowerCase(),
			);
		let name = "New lineup";
		for (let at = 2; taken(name); at += 1) {
			name = `New lineup ${at}`;
		}
		const id = idFor(name, this.draft.lineups);
		const color =
			LINEUP_COLORS.find(
				(each) => !this.draft.lineups.some((lineup) => lineup.color === each),
			) ??
			LINEUP_COLORS[this.draft.lineups.length % LINEUP_COLORS.length] ??
			"slate";
		const agent = this.agents[0];
		const pick: AgentPick =
			agent === undefined ? { agent: "claude" } : { agent: agent.id };
		const model = agent?.models[0]?.id;
		if (model !== undefined) {
			pick.model = model;
		}
		this.edit((rules) => ({
			...rules,
			lineups: [...rules.lineups, { id, name, color, picks: [pick] }],
		}));
		return id;
	}

	/** Deletes lineup `id`, unless a cell still sends tasks to it. */
	removeLineup(id: string): void {
		if (this.uses(id).length > 0) {
			return;
		}
		this.edit((rules) => ({
			...rules,
			lineups: rules.lineups.filter((each) => each.id !== id),
		}));
	}

	/** Renames lineup `id`; its id, which the routes name it by, stays. */
	rename(id: string, name: string): void {
		this.editLineup(id, (lineup) => ({ ...lineup, name }));
	}

	recolor(id: string, color: LineupColor): void {
		this.editLineup(id, (lineup) => ({ ...lineup, color }));
	}

	/**
	 * Whether lineup `id` already picks the plan `agent` runs `model` on,
	 * apart from its pick `except`.
	 */
	has(
		id: string,
		agent: string,
		model: string | undefined,
		except?: number,
	): boolean {
		const plan = planOf(model === undefined ? { agent } : { agent, model });
		return (this.lineup(id)?.picks ?? []).some(
			(each, at) => at !== except && planOf(each) === plan,
		);
	}

	/**
	 * Adds `agent` on `model`, or its default model, at the end of lineup
	 * `id`'s picks, at the thinking level its others take where the agent
	 * offers it. Does nothing when the lineup names it already.
	 */
	addPick(id: string, agent: string, model: string | undefined): void {
		if (this.has(id, agent, model)) {
			return;
		}
		const offered = this.efforts(agent);
		const effort = this.lineup(id)?.picks.find(
			(each) => each.effort !== undefined && offered.includes(each.effort),
		)?.effort;
		const pick: AgentPick = { agent };
		if (model !== undefined) {
			pick.model = model;
		}
		if (effort !== undefined) {
			pick.effort = effort;
		}
		this.editLineup(id, (lineup) => ({
			...lineup,
			picks: [...lineup.picks, pick],
		}));
	}

	/** Removes pick `pick` of lineup `id`, never its last. */
	removePick(id: string, pick: number): void {
		this.editLineup(id, (lineup) =>
			lineup.picks.length < 2
				? lineup
				: { ...lineup, picks: lineup.picks.filter((_, at) => at !== pick) },
		);
	}

	/** Moves pick `from` of lineup `id` to place `to`. */
	movePick(id: string, from: number, to: number): void {
		this.editLineup(id, (lineup) => {
			const moved = lineup.picks[from];
			if (moved === undefined || from === to || to < 0) {
				return lineup;
			}
			const picks = lineup.picks.filter((_, at) => at !== from);
			picks.splice(to, 0, moved);
			return { ...lineup, picks };
		});
	}

	/**
	 * Sets pick `pick` of lineup `id` to `agent` on `model` (undefined for its
	 * default), keeping its thinking level where the agent offers it. Does
	 * nothing when another pick of the lineup names it already.
	 */
	setModel(
		id: string,
		pick: number,
		agent: string,
		model: string | undefined,
	): void {
		if (this.has(id, agent, model, pick)) {
			return;
		}
		const efforts = this.efforts(agent);
		this.editPick(id, pick, (each) => {
			const next: AgentPick = { agent };
			if (model !== undefined) {
				next.model = model;
			}
			if (
				each.effort !== undefined &&
				(each.agent === agent || efforts.includes(each.effort))
			) {
				next.effort = each.effort;
			}
			return next;
		});
	}

	/** Sets a pick's thinking level; undefined for the agent's default. */
	setEffort(id: string, pick: number, effort: string | undefined): void {
		this.editPick(id, pick, ({ effort: _, ...rest }) =>
			effort === undefined ? rest : { ...rest, effort },
		);
	}

	/** The thinking levels a pick of `agent` can name: those it offered, or the usual three. */
	efforts(agent: string): string[] {
		return this.agents.find((each) => each.id === agent)?.efforts ?? EFFORTS;
	}

	/**
	 * Saves the draft, marked saving until the server answers; throws, the
	 * saved rules put back, when it does not check out or the server refuses it.
	 */
	async save(): Promise<void> {
		const problem = this.problem;
		if (problem !== null) {
			throw new Error(problem);
		}
		const draft = this.draft;
		this.saving = true;
		this.changed();
		try {
			await this.write(draft, () => this.store.save(draft));
		} finally {
			this.saving = false;
			this.changed();
		}
	}

	/** Saves only one section, retaining unrelated edits and drafts on failure. */
	async apply(
		section:
			| "routes"
			| "settings"
			| { lineup: string; cells?: readonly Cell[] },
	): Promise<void> {
		if (this.saved === null || this.saving) {
			throw new Error("Wait for the current save to finish");
		}
		const before = this.draft;
		const select = (
			base: AutoPickRules,
			source: AutoPickRules,
		): AutoPickRules => {
			if (section === "routes") {
				return { ...base, routes: source.routes };
			}
			if (section === "settings") {
				return {
					...base,
					threshold: source.threshold,
					pace: source.pace,
					holdout: source.holdout,
				};
			}
			if (section.cells !== undefined) {
				const routes = structuredClone(base.routes);
				for (const cell of section.cells) {
					routes[cell.kind][cell.depth] = section.lineup;
				}
				return { ...base, routes };
			}
			const lineup = source.lineups.find((each) => each.id === section.lineup);
			const lineups = base.lineups.filter((each) => each.id !== section.lineup);
			if (lineup !== undefined) {
				const at = base.lineups.findIndex((each) => each.id === section.lineup);
				lineups.splice(at < 0 ? lineups.length : at, 0, lineup);
			}
			return { ...base, lineups };
		};
		const sent = select(this.saved, before);
		const checked = checkRules(sent);
		if (!checked.ok) {
			throw new Error(checked.problem);
		}
		this.saving = true;
		this.changed();
		try {
			const view = await this.store.save(sent);
			const pending = this.draft;
			this.take(view);
			this.draft = select(pending, view.rules);
		} finally {
			this.saving = false;
			this.changed();
		}
	}

	/** Deletes one unused lineup, retaining drafts when the server refuses. */
	async deleteLineup(id: string): Promise<void> {
		const before = this.draft;
		this.removeLineup(id);
		try {
			await this.apply({ lineup: id });
		} catch (error) {
			this.draft = { ...this.draft, lineups: before.lineups };
			this.changed();
			throw error;
		}
	}

	/** Cancels just one lineup's edits, including an unapplied new lineup. */
	discardLineup(id: string): void {
		const saved = this.saved?.lineups.find((each) => each.id === id);
		this.edit((rules) => ({
			...rules,
			lineups: rules.lineups.flatMap((each) =>
				each.id !== id ? [each] : saved === undefined ? [] : [saved],
			),
		}));
	}

	/** Saves the draft when it differs from what the server holds, as Next does. */
	async saveIfDirty(): Promise<void> {
		if (this.dirty) {
			await this.save();
		}
	}

	/** Puts the saved rules back in the draft, dropping every edit. */
	discard(): void {
		if (this.saved !== null) {
			this.draft = this.saved;
			this.changed();
		}
	}

	/** Writes the defaults over the rules, marked saving until the server answers; throws when refused. */
	async reset(): Promise<void> {
		this.saving = true;
		this.changed();
		try {
			await this.write(this.draft, () => this.store.reset());
		} finally {
			this.saving = false;
			this.changed();
		}
	}

	/** Takes what the server answers to `sent`, the draft it was sent with. */
	private async write(
		sent: AutoPickRules,
		send: () => Promise<AutoPickRulesView>,
	): Promise<void> {
		const view = await send();
		// A control moved since: its draft stays, measured against what saved.
		const draft = this.draft;
		this.take(view);
		if (draft !== sent) {
			this.draft = draft;
		}
	}

	private take(view: AutoPickRulesView): void {
		this.saved = view.rules;
		this.draft = view.rules;
		this.agents = view.agents;
		this.fileProblem = view.problem;
	}

	private editPace(field: "slack" | "spent", percent: number): void {
		if (Number.isFinite(percent)) {
			const clamped = Math.min(100, Math.max(0, Math.round(percent)));
			this.edit((rules) => ({
				...rules,
				pace: { ...this.pace, [field]: clamped / 100 },
			}));
		}
	}

	private editLineup(id: string, edit: (lineup: Lineup) => Lineup): void {
		if (this.lineup(id) === undefined) {
			return;
		}
		this.edit((rules) => ({
			...rules,
			lineups: rules.lineups.map((each) =>
				each.id === id ? edit(each) : each,
			),
		}));
	}

	private editPick(
		id: string,
		pick: number,
		edit: (pick: AgentPick) => AgentPick,
	): void {
		this.editLineup(id, (lineup) => ({
			...lineup,
			picks: lineup.picks.map((each, at) => (at === pick ? edit(each) : each)),
		}));
	}

	private edit(change: (rules: AutoPickRules) => AutoPickRules): void {
		this.draft = change(this.draft);
		this.changed();
	}

	private changed(): void {
		this.dispatcher.dispatch("changed");
	}
}

/** The rules over `splates server`'s routes. */
const HTTP_RULES: RulesStore = {
	read: autoPickRules,
	save: saveAutoPickRules,
	reset: resetAutoPickRules,
};
