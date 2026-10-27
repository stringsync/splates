import type {
	AutoPickAgent,
	AutoPickRules,
	AutoPickRulesView,
	ClarityId,
	DepthId,
	KindId,
	Pace,
	Rule,
} from "@stringsync/splates-server/auto-pick";
import {
	ANY,
	DEFAULT_PACE,
	DEFAULT_RULES,
	KIND_IDS,
} from "@stringsync/splates-server/auto-pick/browser";
import { checkRules } from "@stringsync/splates-server/auto-pick/check";
import type { AgentPick } from "@stringsync/splates-server/models";
import { Dispatcher, type Eventful } from "webappwiz/events";
import {
	autoPickRules,
	resetAutoPickRules,
	saveAutoPickRules,
} from "./auto-pick-api";
import type { PickList } from "./auto-pick-pick-chips";

/** Where the editor reads and writes the machine's rules. */
export interface RulesStore {
	read(): Promise<AutoPickRulesView>;
	save(rules: AutoPickRules): Promise<AutoPickRulesView>;
	reset(): Promise<AutoPickRulesView>;
}

export type RulesEditorEvents = { changed: undefined };

/** The thinking levels offered for an agent that has not said which it takes. */
export const EFFORTS = ["low", "medium", "high"];

/**
 * Use this to edit Auto pick rules through `draft` and its setters. Call
 * `load` first, subscribe to `events` for changes, and call `save` or `reset`
 * to write. The last rule stays `* *`, so every task maps somewhere.
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

	/** Whether rule `index` is the last, fixed `* *` rule. */
	fixed(index: number): boolean {
		return index === this.draft.rules.length - 1;
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

	setKind(index: number, kind: KindId | typeof ANY): void {
		this.editRule(index, (rule) => ({ ...rule, kind }));
	}

	setClarity(index: number, clarity: ClarityId | typeof ANY): void {
		this.editRule(index, (rule) => ({ ...rule, clarity }));
	}

	setDepth(index: number, depth: DepthId | typeof ANY): void {
		this.editRule(index, (rule) => ({ ...rule, depth }));
	}

	/** Adds a rule just above the last, where a specific rule has to sit to win. */
	addRule(): void {
		const agent =
			this.agents[0]?.id ?? this.draft.rules.at(-1)?.picks[0]?.agent;
		const rule: Rule = {
			kind: KIND_IDS[0],
			depth: ANY,
			picks: agent === undefined ? [] : [{ agent }],
		};
		this.edit((rules) => ({
			...rules,
			rules: [...rules.rules.slice(0, -1), rule, ...rules.rules.slice(-1)],
		}));
	}

	removeRule(index: number): void {
		if (this.fixed(index)) {
			return;
		}
		this.edit((rules) => ({
			...rules,
			rules: rules.rules.filter((_, at) => at !== index),
		}));
	}

	/** Moves rule `index` up (-1) or down (1), never past the last. */
	moveRule(index: number, by: -1 | 1): void {
		const to = index + by;
		if (this.fixed(index) || to < 0 || this.fixed(to)) {
			return;
		}
		this.edit((rules) => ({
			...rules,
			rules: swapped(rules.rules, index, to),
		}));
	}

	/** Whether rule `index` already names `agent` on `model`, apart from its pick `except`. */
	has(
		index: number,
		agent: string,
		model: string | undefined,
		except?: number,
	): boolean {
		return (this.draft.rules[index]?.picks ?? []).some(
			(each, at) =>
				at !== except && each.agent === agent && each.model === model,
		);
	}

	/**
	 * Adds `agent` on `model`, or its default model, at the end of rule
	 * `index`'s picks, at the thinking level the rule's others take where the
	 * agent offers it. Does nothing when the rule names it already.
	 */
	addPick(index: number, agent: string, model: string | undefined): void {
		if (this.has(index, agent, model)) {
			return;
		}
		const offered = this.efforts(agent);
		const effort = this.draft.rules[index]?.picks.find(
			(each) => each.effort !== undefined && offered.includes(each.effort),
		)?.effort;
		const pick: AgentPick = { agent };
		if (model !== undefined) {
			pick.model = model;
		}
		if (effort !== undefined) {
			pick.effort = effort;
		}
		this.editRule(
			index,
			(rule) => ({ ...rule, picks: [...rule.picks, pick] }),
			true,
		);
	}

	/** Removes pick `pick` of rule `index`, never its last. */
	removePick(index: number, pick: number): void {
		this.editRule(
			index,
			(rule) =>
				rule.picks.length < 2
					? rule
					: { ...rule, picks: rule.picks.filter((_, at) => at !== pick) },
			true,
		);
	}

	/** Moves pick `from` of rule `index` to place `to`. */
	movePick(index: number, from: number, to: number): void {
		this.editRule(
			index,
			(rule) => {
				const moved = rule.picks[from];
				if (moved === undefined || from === to || to < 0) {
					return rule;
				}
				const picks = rule.picks.filter((_, at) => at !== from);
				picks.splice(to, 0, moved);
				return { ...rule, picks };
			},
			true,
		);
	}

	/** Sets a pick's model; undefined for the agent's default. */
	setModel(index: number, pick: number, model: string | undefined): void {
		const agent = this.draft.rules[index]?.picks[pick]?.agent;
		if (agent === undefined || this.has(index, agent, model, pick)) {
			return;
		}
		this.editPick(index, pick, ({ model: _, ...rest }) =>
			model === undefined ? rest : { ...rest, model },
		);
	}

	/** Sets a pick's thinking level; undefined for the agent's default. */
	setEffort(index: number, pick: number, effort: string | undefined): void {
		this.editPick(index, pick, ({ effort: _, ...rest }) =>
			effort === undefined ? rest : { ...rest, effort },
		);
	}

	/** Rule `index`'s picks as a list the rows edit. */
	picksOf(index: number): PickList {
		return {
			label: `rule ${index + 1}`,
			agents: this.agents,
			note: "Tried top to bottom; the next is used once a plan is nearly spent.",
			least: 1,
			efforts: (agent) => this.efforts(agent),
			has: (agent, model, except) => this.has(index, agent, model, except),
			add: (agent, model) => this.addPick(index, agent, model),
			remove: (pick) => this.removePick(index, pick),
			move: (from, to) => this.movePick(index, from, to),
			setModel: (pick, model) => this.setModel(index, pick, model),
			setEffort: (pick, effort) => this.setEffort(index, pick, effort),
		};
	}

	/** The model ids a pick of `agent` can name: the roster's for it. */
	models(agent: string): string[] {
		return (
			this.agents
				.find((each) => each.id === agent)
				?.models.map((each) => each.id) ?? []
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

	/** Saves the draft when it differs from what the server holds, as Next does. */
	async saveIfDirty(): Promise<void> {
		if (this.dirty) {
			await this.save();
		}
	}

	/** Writes the defaults over the rules, shown at once; throws, put back, when refused. */
	async reset(): Promise<void> {
		const before = this.draft;
		this.draft = DEFAULT_RULES;
		try {
			await this.write(DEFAULT_RULES, () => this.store.reset());
		} catch (error) {
			this.draft = before;
			this.changed();
			throw error;
		}
	}

	/** Shows `rules` as saved at once, taking what the server answers, or putting back what was. */
	private async write(
		rules: AutoPickRules,
		send: () => Promise<AutoPickRulesView>,
	): Promise<void> {
		const before = this.saved;
		this.saved = rules;
		this.changed();
		try {
			const view = await send();
			// A control moved since: its draft stays, measured against what saved.
			const edited = this.draft !== rules;
			const draft = this.draft;
			this.take(view);
			if (edited) {
				this.draft = draft;
			}
		} catch (error) {
			if (this.saved === rules) {
				this.saved = before;
			}
			throw error;
		} finally {
			this.changed();
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

	private editRule(
		index: number,
		edit: (rule: Rule) => Rule,
		picksOnly = false,
	): void {
		if (!picksOnly && this.fixed(index)) {
			return;
		}
		this.edit((rules) => ({
			...rules,
			rules: rules.rules.map((rule, at) => (at === index ? edit(rule) : rule)),
		}));
	}

	private editPick(
		index: number,
		pick: number,
		edit: (pick: AgentPick) => AgentPick,
	): void {
		this.editRule(
			index,
			(rule) => ({
				...rule,
				picks: rule.picks.map((each, at) => (at === pick ? edit(each) : each)),
			}),
			true,
		);
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

/** `items` with those at `from` and `to` swapped. */
function swapped<T>(items: readonly T[], from: number, to: number): T[] {
	const next = [...items];
	const moved = next[from] as T;
	next[from] = next[to] as T;
	next[to] = moved;
	return next;
}
