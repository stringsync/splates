import type { SecretStore } from "webappwiz/creds";
import type { Fs } from "webappwiz/system";
import { z } from "zod";
import { fail } from "./exit";

/**
 * Setting arbor up on this machine: the roster's steps, which the user has
 * skipped, kept in `~/.arbor/setup.json` so a skipped step stops asking, and
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
		fail("not_found", `no setup step '${id}': \`arbor setup\` lists them`, {
			step: id,
		});
	}

	/** Every step checked, by area, and the one to do next. */
	async read(): Promise<SetupProgress> {
		const skipped = new Set(await this.#skipped());
		const statuses = new Map<SetupStep, StepStatus>();
		const areas: AreaProgress[] = [];
		for (const area of this.#areas) {
			const steps: StepProgress[] = [];
			for (const step of area.steps) {
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

	async #skipped(): Promise<string[]> {
		const raw = await this.#machine.fs.read(this.#path).catch(() => null);
		if (raw === null) {
			return [];
		}
		const parsed = SKIPS.safeParse(JSON.parse(raw));
		if (!parsed.success) {
			throw new Error(
				`${this.#path} is not what arbor saved: remove it to ask every step again`,
			);
		}
		// A newer arbor's: ask everything rather than misread it.
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

/** What a step's check reads: this machine's arbor home and its device store. */
export interface SetupMachine {
	fs: Fs;
	/** `~/.arbor`, or a test's own. */
	home: string;
	/** The device's secret store, where creds kept for every project live. */
	device: SecretStore;
}

/**
 * One thing to set up, small enough that the user does at most one thing for
 * it. Whether it is done comes from its check against real state, never a
 * stored flag, so a step undone by hand shows as left again.
 */
export interface SetupStep {
	/** How `arbor setup <step>` and the page name it, lowercase-with-dashes. */
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
}

/** A part of setup, such as remote access, and its steps in order. */
export interface SetupArea {
	readonly id: string;
	readonly title: string;
	readonly steps: readonly SetupStep[];
}

/** A step's state: done and skipped are settled, ready can go now, waiting cannot yet. */
export type StepStatus = "done" | "skipped" | "ready" | "waiting";

/** A step as `arbor setup --json` and `GET /api/setup` give it. */
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
	/** Whether any required step is neither done nor skipped. */
	required: boolean;
}

/** The file's own format. */
const FORMAT = 1;

const SKIPS = z.object({
	format: z.number(),
	skipped: z.array(z.string()),
});

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
