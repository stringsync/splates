import type { SecretStore } from "webappwiz/creds";
import type { Fs, Ps } from "webappwiz/system";
import { z } from "zod";
import type { Config } from "../config";
import { fail } from "../exit";
import type {
	WorkerBudgetReport,
	WorkerLimit,
	WorkerListing,
} from "../workers";
import type { OpenCodeSetup } from "./opencode";
import { StepProblem } from "./step-problem";

/**
 * Setting splates up on this machine: the roster's steps, which the user has
 * skipped, kept in `~/.splates/setup.json` so a skipped step stops asking, and
 * where each stands.
 */
export class Setup {
	readonly #areas: readonly SetupArea[];
	readonly #machine: SetupMachine;

	constructor(machine: SetupMachine, areas: readonly SetupArea[]) {
		checkRoster(areas);
		this.#areas = areas;
		this.#machine = machine;
	}

	get #path(): string {
		return `${this.#machine.home}/setup.json`;
	}

	/** The step `id` names, refusing one not on the roster. */
	step(id: string): SetupStep {
		for (const area of this.#areas) {
			const found = area.steps.find((step) => step.id === id);
			if (found !== undefined) {
				return found;
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
		const step = this.step(id);
		for (const before of step.after) {
			if (!(await checked(before, this.#machine)).done) {
				throw new StepProblem(`Do "${before.title}" first.`);
			}
		}
		for (const field of step.fields ?? []) {
			const answer = answers[field.name];
			if (field.kind === "yes-no") {
				if (typeof answer !== "boolean") {
					throw new StepProblem(`Say yes or no to "${field.label}".`);
				}
				continue;
			}
			if (field.kind === "cred") {
				if ((await this.#machine.device.get(field.name)) === undefined) {
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
			for (const step of area.steps) {
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
						step.fields?.find((field) => field.kind === "cred")?.name ?? null,
					fields: await fieldsOf(step, this.#machine),
					doing: step.doing ?? null,
					detail:
						(await step.detail?.(this.#machine).catch(() => null)) ?? null,
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
				steps,
			});
		}
		const all = areas.flatMap((area) => area.steps);
		const ready = all.filter((step) => step.status === "ready");
		const next = ready.find((step) => !step.optional) ?? ready[0] ?? null;
		return {
			areas,
			next: next?.id ?? null,
			fresh: !(await this.#machine.fs.exists(this.#path)),
			required: all.some(
				(step) =>
					!step.optional &&
					(step.status === "ready" || step.status === "waiting"),
			),
		};
	}

	/** Stops `id` asking, until `unskip`. */
	async skip(id: string): Promise<void> {
		this.step(id);
		const skipped = await this.#skipped();
		if (!skipped.includes(id)) {
			await this.#save([...skipped, id]);
		}
	}

	/** Asks for `id` again. */
	async unskip(id: string): Promise<void> {
		this.step(id);
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
		if (!(await this.#machine.fs.exists(this.#path))) {
			await this.#save([]);
		}
	}

	async #skipped(): Promise<string[]> {
		const raw = await this.#machine.fs.read(this.#path).catch(() => null);
		if (raw === null) {
			return [];
		}
		const parsed = SKIPS.safeParse(JSON.parse(raw));
		if (!parsed.success) {
			throw new Error(
				`${this.#path} is not what splates saved: remove it to ask every step again`,
			);
		}
		// A newer splates's: ask everything rather than misread it.
		return parsed.data.format > FORMAT ? [] : parsed.data.skipped;
	}

	async #save(skipped: string[]): Promise<void> {
		const { fs, home } = this.#machine;
		await fs.mkdir(home, { recursive: true });
		// Through a temporary file, so a reader never sees half of it.
		const tmp = `${this.#path}.${crypto.randomUUID()}.tmp`;
		await fs.write(
			tmp,
			`${JSON.stringify({ format: FORMAT, skipped }, null, "\t")}\n`,
		);
		await fs.rename(tmp, this.#path);
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
	/** The worker budget of the `splates server`, for the steps that read it; none with no server to ask. */
	workerBudget?: SetupWorkerBudget;
}

/** The worker budget as a step reads and sets it. */
export interface SetupWorkerBudget {
	report(): Promise<Pick<WorkerBudgetReport, "standing" | "reviewed">>;
	/** Sets `limit` to `dollars`; null gives it back to its default. */
	set(limit: WorkerLimit, dollars: number | null): Promise<void>;
}

/** A worker as a step reads it, from `GET /api/workers`. */
export type SetupWorker = Pick<
	WorkerListing,
	"id" | "kind" | "draining" | "removing"
>;

/** What a step that sets up a repository reads of its project, afresh each time. */
export interface SetupProject {
	readonly root: string;
	/** Its `splates.config.ts`, as it stands now. */
	config(): Promise<Pick<Config, "trunk" | "remote" | "workerProvider">>;
	/** The URL `remote` fetches from, or null when there is no such remote. */
	remoteUrl(remote: string): Promise<string | null>;
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
	/** Markdown on this machine's own state for the step, as what a choice costs; none when absent. */
	detail?(machine: SetupMachine): Promise<string | null>;
	/**
	 * What its page asks, in order; none when the user does the step
	 * outside the page, as signing in on a phone, and Next only checks.
	 */
	readonly fields?: readonly StepField[];
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
	 * What the page says when Next finds the step still not done, as "Sign
	 * in on your phone, then press Next."
	 */
	readonly notDone?: string;
}

/**
 * One thing a step's page asks. `name` keys its answer, and for a cred is
 * the cred's own name, as `OPENAI_API_KEY`, which Next saves for the device
 * before it submits, so a step's `submit` reads it from `machine.device`.
 */
export type StepField =
	| { kind: "cred"; name: string; label: string; help?: string }
	| {
			kind: "text";
			name: string;
			label: string;
			placeholder?: string;
			/** May be left empty, as a team name only some accounts need. */
			optional?: boolean;
	  }
	| { kind: "yes-no"; name: string; label: string }
	| {
			kind: "choice";
			name: string;
			label: string;
			/** What may be picked, read each time the page reads setup. */
			options(machine: SetupMachine): Promise<readonly StepOption[]>;
	  };

/** One choice a `choice` field lists. */
export interface StepOption {
	value: string;
	label: string;
}

/** What the user answered on a step's page, by field name. */
export type StepAnswers = Record<string, string | boolean>;

/** A field as the page draws it: a choice's options listed, a cred saved or not. */
export type FieldProgress =
	| {
			kind: "cred";
			name: string;
			label: string;
			help: string | null;
			saved: boolean;
	  }
	| {
			kind: "text";
			name: string;
			label: string;
			placeholder: string | null;
			optional: boolean;
	  }
	| { kind: "yes-no"; name: string; label: string }
	| { kind: "choice"; name: string; label: string; options: StepOption[] };

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
}

export interface AreaProgress {
	id: string;
	title: string;
	done: number;
	skipped: number;
	/** Steps neither done nor skipped. */
	left: number;
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

/** `step`'s fields as the page draws them. */
async function fieldsOf(
	step: SetupStep,
	machine: SetupMachine,
): Promise<FieldProgress[]> {
	const fields: FieldProgress[] = [];
	for (const field of step.fields ?? []) {
		switch (field.kind) {
			case "cred":
				fields.push({
					...field,
					help: field.help ?? null,
					saved: (await machine.device.get(field.name)) !== undefined,
				});
				break;
			case "text":
				fields.push({
					...field,
					placeholder: field.placeholder ?? null,
					optional: field.optional ?? false,
				});
				break;
			case "yes-no":
				fields.push(field);
				break;
			case "choice": {
				const { options, ...rest } = field;
				// A list that will not read leaves the field empty, so the rest
				// of setup still reads; Next then says to pick one.
				const listed = await options(machine).catch(() => []);
				fields.push({ ...rest, options: [...listed] });
				break;
			}
		}
	}
	return fields;
}

/** Whether `step` is on the roster for this machine; a throw reading that hides it. */
async function listed(
	step: SetupStep,
	machine: SetupMachine,
): Promise<boolean> {
	return (await step.shown?.(machine).catch(() => false)) ?? true;
}

/** A step's check, a throw turned into the problem it reports. */
async function checked(
	step: SetupStep,
	machine: SetupMachine,
): Promise<{ done: boolean; problem: string | null }> {
	try {
		return { done: await step.check(machine), problem: null };
	} catch (error) {
		return {
			done: false,
			problem: error instanceof Error ? error.message : String(error),
		};
	}
}

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
