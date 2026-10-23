import type { SecretStore } from "webappwiz/creds";
import type { Fs, Ps } from "webappwiz/system";
import { z } from "zod";
import type { Config } from "../config";
import { fail } from "../exit";
import type { ReplicaStatus } from "../replica";
import { type Document, FsStorage } from "../storage";
import type { WorkerListing } from "../workers";
import { checked, listed } from "./checks";
import {
	type FieldProgress,
	fieldsIn,
	fieldsOf,
	type StepField,
} from "./fields";
import type { OpenCodeSetup } from "./opencode";
import { StepProblem } from "./step-problem";
import { SetupUndo, type StepUndo, type UndoPlan } from "./undo";

/**
 * Setting splates up on this machine: the roster's steps, which the user has
 * skipped, kept in `~/.splates/setup.json` so a skipped step stops asking, and
 * where each stands.
 */
export class Setup {
	readonly #areas: readonly SetupArea[];
	readonly #machine: SetupMachine;
	readonly #undo: SetupUndo;

	constructor(machine: SetupMachine, areas: readonly SetupArea[]) {
		checkRoster(areas);
		this.#areas = areas;
		this.#machine = machine;
		this.#undo = new SetupUndo(machine, areas);
	}

	get #file(): Document<unknown> {
		return new FsStorage(this.#machine.home, this.#machine.fs).document(
			"setup.json",
		);
	}

	/** The step `id` names, one a step stands for on this machine among them, refusing one not on the roster. */
	async step(id: string): Promise<SetupStep> {
		for (const area of this.#areas) {
			for (const step of await this.#stepsOf(area)) {
				if (step.id === id) {
					return step;
				}
			}
		}
		fail("not_found", `no setup step '${id}': \`splates setup\` lists them`, {
			step: id,
		});
	}

	/**
	 * Does what step `id` needs with what the user answered on its page:
	 * runs the step's `submit`, then checks it. The page saves a cred
	 * pasted into it first, through the creds routes, so it fills any
	 * request for it; here a cred need only be kept. Throws a `StepProblem`, one line for the
	 * page, when an answer is missing, the work fails, or the step still
	 * reads not done.
	 */
	async submit(id: string, answers: StepAnswers): Promise<SetupProgress> {
		const step = await this.step(id);
		for (const before of step.after) {
			if (!(await checked(before, this.#machine)).done) {
				throw new StepProblem(`Do "${before.title}" first.`);
			}
		}
		for (const field of await fieldsIn(step, this.#machine)) {
			const answer = answers[field.name];
			if (field.kind === "yes-no") {
				if (typeof answer !== "boolean") {
					throw new StepProblem(`Say yes or no to "${field.label}".`);
				}
				continue;
			}
			if (field.kind === "cred") {
				if (
					!field.optional &&
					(await this.#machine.device.get(field.name)) === undefined
				) {
					throw new StepProblem(`Paste the ${field.label} first.`);
				}
				continue;
			}
			const text = typeof answer === "string" ? answer.trim() : "";
			if (text === "" && field.kind === "text" && field.optional) {
				continue;
			}
			if (text === "") {
				throw new StepProblem(`Fill in "${field.label}" first.`);
			}
			if (
				field.kind === "choice" &&
				!(await field.options(this.#machine)).some(
					(option) => option.value === text,
				)
			) {
				throw new StepProblem(`Pick one of the choices for "${field.label}".`);
			}
		}
		try {
			await step.submit?.(this.#machine, answers);
		} catch (error) {
			throw new StepProblem(
				error instanceof Error ? error.message : String(error),
			);
		}
		const { done, problem } = await checked(step, this.#machine);
		if (!done) {
			throw new StepProblem(problem ?? step.notDone ?? NOT_DONE);
		}
		return this.read();
	}

	/** Every step checked, by area, and the one to do next. */
	async read(): Promise<SetupProgress> {
		const skipped = new Set(await this.#skipped());
		const statuses = new Map<SetupStep, StepStatus>();
		const areas: AreaProgress[] = [];
		for (const area of this.#areas) {
			const steps: StepProgress[] = [];
			for (const step of await this.#stepsOf(area, true)) {
				if (step.each !== undefined) {
					statuses.set(step, await this.#standInStatus(step, statuses));
					continue;
				}
				if (!(await listed(step, this.#machine))) {
					continue;
				}
				const { done, problem } = await checked(step, this.#machine);
				// Prerequisites come earlier on the roster, so each is settled here.
				const before = step.after.map((each) => statuses.get(each));
				const status: StepStatus = done
					? "done"
					: skipped.has(step.id) || before.includes("skipped")
						? "skipped"
						: before.every((each) => each === "done")
							? "ready"
							: "waiting";
				statuses.set(step, status);
				steps.push({
					id: step.id,
					title: step.title,
					why: step.why,
					user: step.user,
					agent: step.agent,
					optional: step.optional,
					after: step.after.map((each) => each.id),
					status,
					problem,
					cred:
						(await fieldsIn(step, this.#machine).catch(() => [])).find(
							(field) => field.kind === "cred",
						)?.name ?? null,
					fields: await fieldsOf(step, this.#machine),
					doing: step.doing ?? null,
					detail:
						(await step.detail?.(this.#machine).catch(() => null)) ?? null,
					warning:
						(await step.warning?.(this.#machine).catch(() => null)) ?? null,
					data: (await step.data?.(this.#machine).catch(() => null)) ?? null,
				});
			}
			areas.push({
				id: area.id,
				title: area.title,
				done: steps.filter((step) => step.status === "done").length,
				skipped: steps.filter((step) => step.status === "skipped").length,
				left: steps.filter(
					(step) => step.status === "ready" || step.status === "waiting",
				).length,
				undoable: false,
				steps,
			});
		}
		const done = new Set(
			[...statuses].flatMap(([step, status]) =>
				status === "done" ? [step] : [],
			),
		);
		for (const area of areas) {
			area.undoable = await this.#undo.undoable(area.id, done);
		}
		const all = areas.flatMap((area) => area.steps);
		const ready = all.filter((step) => step.status === "ready");
		const next = ready.find((step) => !step.optional) ?? ready[0] ?? null;
		return {
			areas,
			next: next?.id ?? null,
			fresh: (await this.#file.read()) === null,
			required: all.some(
				(step) =>
					!step.optional &&
					(step.status === "ready" || step.status === "waiting"),
			),
		};
	}

	/** Stops `id` asking, until `unskip`. */
	async skip(id: string): Promise<void> {
		await this.step(id);
		const skipped = await this.#skipped();
		if (!skipped.includes(id)) {
			await this.#save([...skipped, id]);
		}
	}

	/** Asks for `id` again. */
	async unskip(id: string): Promise<void> {
		await this.step(id);
		const skipped = await this.#skipped();
		if (skipped.includes(id)) {
			await this.#save(skipped.filter((each) => each !== id));
		}
	}

	/**
	 * Marks setup as seen on this machine, so the page stops nudging a fresh
	 * one towards it.
	 */
	async see(): Promise<void> {
		if ((await this.#file.read()) === null) {
			await this.#save([]);
		}
	}

	/** What undoing area `id` would do, as `SetupUndo` plans it. */
	undoPlan(id: string): Promise<UndoPlan> {
		return this.#undo.plan(id);
	}

	/**
	 * Undoes area `id`, `confirm` the name its plan asks typed, answering
	 * the fresh progress; a `StepProblem` when it will not go.
	 */
	async undo(id: string, confirm: string | null): Promise<SetupProgress> {
		await this.#undo.run(id, confirm);
		return this.read();
	}

	/**
	 * `area`'s steps here, each that stands for others given way to what it
	 * stands for, and kept after them when `standIns`, to be settled there.
	 */
	async #stepsOf(area: SetupArea, standIns = false): Promise<SetupStep[]> {
		const steps: SetupStep[] = [];
		for (const step of area.steps) {
			if (step.each === undefined) {
				steps.push(step);
				continue;
			}
			steps.push(...(await step.each(this.#machine).catch(() => [])));
			if (standIns) {
				steps.push(step);
			}
		}
		return steps;
	}

	/**
	 * The status of a step that stands for others, for the steps after it:
	 * done when its check is, skipped once each it stands for is settled and
	 * one is skipped, and waiting otherwise.
	 */
	async #standInStatus(
		step: SetupStep,
		statuses: ReadonlyMap<SetupStep, StepStatus>,
	): Promise<StepStatus> {
		if ((await checked(step, this.#machine)).done) {
			return "done";
		}
		const each = [...statuses].flatMap(([one, status]) =>
			one.of === step ? [status] : [],
		);
		return each.includes("skipped") &&
			each.every((status) => status === "done" || status === "skipped")
			? "skipped"
			: "waiting";
	}

	async #skipped(): Promise<string[]> {
		const raw = await this.#file.read();
		if (raw === null) {
			return [];
		}
		const parsed = SKIPS.safeParse(raw);
		if (!parsed.success) {
			throw new Error(
				`${this.#file.key} is not what splates saved: remove it to ask every step again`,
			);
		}
		// A newer splates's: ask everything rather than misread it.
		return parsed.data.format > FORMAT ? [] : parsed.data.skipped;
	}

	async #save(skipped: string[]): Promise<void> {
		await this.#file.write({ format: FORMAT, skipped });
	}
}

/** What a step's check reads: this machine's splates home and its device store. */
export interface SetupMachine {
	/** Explicit checks from the optional native setup panel; never launch on page load. */
	opencode?: OpenCodeSetup;
	fs: Fs;
	/** How a step runs a program, as `claude --version`; none runs nothing. */
	ps?: Ps;
	/** `~/.splates`, or a test's own. */
	home: string;
	/** The device's secret store, where creds kept for every project live. */
	device: SecretStore;
	/** How a check reaches the network, as for Access; the global one by default. */
	fetch?: typeof globalThis.fetch;
	/**
	 * The project setup is opened from, for the steps that set up its
	 * repository rather than the machine; none outside one.
	 */
	project?: SetupProject;
	/** The workers `splates server` lists, for the steps that read the pool; none with no server to ask. */
	workers?(): Promise<readonly SetupWorker[]>;
	/**
	 * Removes worker `id` from the pool, revoking its key, as `splates worker
	 * remove` does; one with agents on it drains first. None with no server.
	 */
	removeWorker?(id: string): Promise<void>;
	/**
	 * Deletes what `splates tunnel setup` and the slots made in Cloudflare and
	 * forgets their saved files, as `splates tunnel remove` does. None outside
	 * a project, whose creds it reads the API token through.
	 */
	removeTunnel?(): Promise<void>;
}

/** A worker as a step reads it, from `GET /api/workers`. */
export type SetupWorker = Pick<
	WorkerListing,
	"id" | "kind" | "draining" | "removing" | "host"
>;

/** What a step that sets up a repository reads of its project, afresh each time. */
export interface SetupProject {
	readonly root: string;
	/** Its `splates.config.ts`, as it stands now. */
	config(): Promise<Pick<Config, "trunk" | "remote" | "replica">>;
	/** The URL `remote` fetches from, or null when there is no such remote. */
	remoteUrl(remote: string): Promise<string | null>;
	/**
	 * Where its replica stands: as of now while `splates server` keeps it,
	 * else as of its last batch; null when none has run. None when its
	 * records cannot be read.
	 */
	replica?(): Promise<ReplicaStatus | null>;
	/** Whether its creds, the project's then the device's, keep `name`. None when they cannot be read. */
	kept?(name: string): Promise<boolean>;
}

/**
 * One thing to set up, small enough that the user does at most one thing for
 * it. Whether it is done comes from its check against real state, never a
 * stored flag, so a step undone by hand shows as left again.
 */
export interface SetupStep {
	/** How `splates setup <step>` and the page name it, lowercase-with-dashes. */
	readonly id: string;
	readonly title: string;
	/** Why it matters, in a sentence. */
	readonly why: string;
	/** The one thing the user does, in markdown. */
	readonly user: string;
	/** What the agent walking the user through it does, in markdown. */
	readonly agent: string;
	/** An optional step can be left undone for good; a required one cannot. */
	readonly optional: boolean;
	/** The steps that must be done first, on the roster before this one. */
	readonly after: readonly SetupStep[];
	/** Whether it is done, from real state. */
	check(machine: SetupMachine): Promise<boolean>;
	/** Whether the roster lists it at all on this machine; always when absent. */
	shown?(machine: SetupMachine): Promise<boolean>;
	/**
	 * The steps it stands for on this machine, as one per GitHub owner its
	 * projects are under, which the roster lists in its place, each with an
	 * id of its own and `of` it. Its own check says whether all are done,
	 * for the steps `after` it, and its undo takes them all back.
	 */
	each?(machine: SetupMachine): Promise<readonly SetupStep[]>;
	/** The step it is one of, when made by that step's `each`. */
	readonly of?: SetupStep;
	/** Markdown on this machine's own state for the step, as what a choice costs; none when absent. */
	detail?(machine: SetupMachine): Promise<string | null>;
	/**
	 * Markdown on what wants putting right though the step may be done, and
	 * how, as a root key signing in; null when nothing does, and none when
	 * absent. The page stops on a step while it has one.
	 */
	warning?(machine: SetupMachine): Promise<string | null>;
	/**
	 * What the step's own page body draws, as JSON, as the deploy keys to
	 * add; none when absent. Only a step the page draws itself has one.
	 */
	data?(machine: SetupMachine): Promise<StepData | null>;
	/**
	 * What its page asks, in order, or how to read it on this machine, as
	 * the token of the cloud chosen; none when the user does the step
	 * outside the page, as signing in on a phone, and Next only checks.
	 */
	readonly fields?:
		| readonly StepField[]
		| ((machine: SetupMachine) => Promise<readonly StepField[]>);
	/**
	 * Does what the step needs once the user presses Next, each cred field
	 * already saved for the device: runs an install, writes the roster. Throws an
	 * error whose message is one line the page shows. Without one, Next only
	 * checks.
	 */
	submit?(machine: SetupMachine, answers: StepAnswers): Promise<void>;
	/** A line on what `submit` runs, as "Installing OpenCode with npm…". */
	readonly doing?: string;
	/**
	 * How to take the step back out, run when its area is undone; without
	 * one, undoing only forgets its creds.
	 */
	readonly undo?: StepUndo;
	/**
	 * What the step needs to go on working, or to be undone, that others
	 * share: creds, as the token a box is destroyed with.
	 * Undoing another area keeps each while this step is done, and undoing
	 * this one forgets its creds.
	 */
	readonly uses?: readonly string[];
	/**
	 * What the page says when Next finds the step still not done, as "Sign
	 * in on your phone, then press Next."
	 */
	readonly notDone?: string;
}

/** What the user answered on a step's page, by field name. */
export type StepAnswers = Record<string, string | boolean>;

/** A part of setup, such as remote access, and its steps in order. */
export interface SetupArea {
	readonly id: string;
	readonly title: string;
	readonly steps: readonly SetupStep[];
}

/** A step's state: done and skipped are settled, ready can go now, waiting cannot yet. */
export type StepStatus = "done" | "skipped" | "ready" | "waiting";

/** A step as `splates setup --json` and `GET /api/setup` give it. */
export interface StepProgress {
	id: string;
	title: string;
	why: string;
	user: string;
	agent: string;
	optional: boolean;
	after: string[];
	status: StepStatus;
	/** What went wrong checking it, or null when the check ran. */
	problem: string | null;
	/** The cred the user pastes for it, or null. */
	cred: string | null;
	/** What its page asks. */
	fields: FieldProgress[];
	/** A line on what its Next runs, or null. */
	doing: string | null;
	/** Markdown on this machine's state for it, or null. */
	detail: string | null;
	/** Markdown on what wants putting right, and how, or null. */
	warning: string | null;
	/** What its own page body draws, or null. */
	data: StepData | null;
}

/** What a step hands its own page body, as JSON. */
export type StepData = Record<string, unknown>;

export interface AreaProgress {
	id: string;
	title: string;
	done: number;
	skipped: number;
	/** Steps neither done nor skipped. */
	left: number;
	/** Whether a step is done or started, so Undo has something to take out. */
	undoable: boolean;
	steps: StepProgress[];
}

export interface SetupProgress {
	areas: AreaProgress[];
	/** The one step to do next, or null when nothing is ready. */
	next: string | null;
	/** Whether no one has opened setup on this machine yet. */
	fresh: boolean;
	/** Whether any required step is neither done nor skipped. */
	required: boolean;
}

/** The file's own format. */
const FORMAT = 1;

const SKIPS = z.object({
	format: z.number(),
	skipped: z.array(z.string()),
});

/** What the page says when Next finds a step not done and it says nothing. */
const NOT_DONE = "This step is not done yet: do it, then press Next.";

/**
 * Refuses a roster that names one id twice, or a step that waits on one not
 * on the roster before it, so the order it is declared in is the order it
 * can be done in.
 */
function checkRoster(areas: readonly SetupArea[]): void {
	const seen = new Set<SetupStep>();
	const ids = new Set<string>();
	for (const area of areas) {
		if (ids.has(area.id)) {
			throw new Error(`setup names '${area.id}' twice`);
		}
		ids.add(area.id);
	}
	const steps = new Set<string>();
	for (const step of areas.flatMap((area) => area.steps)) {
		if (steps.has(step.id)) {
			throw new Error(`setup names step '${step.id}' twice`);
		}
		for (const before of step.after) {
			if (!seen.has(before)) {
				throw new Error(
					`setup step '${step.id}' waits on '${before.id}', which is not on the roster before it`,
				);
			}
		}
		steps.add(step.id);
		seen.add(step);
	}
}
