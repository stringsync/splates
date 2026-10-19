import { fail } from "../exit";
import { checked, listed } from "./checks";
import { fieldsIn } from "./fields";
import type { SetupArea, SetupMachine, SetupStep } from "./setup";
import { StepProblem } from "./step-problem";

/**
 * Taking a setup area back out: each done step's undo, last first, then the
 * creds they saved, but for one a step still done elsewhere uses.
 */
export class SetupUndo {
	readonly #areas: readonly SetupArea[];
	readonly #machine: SetupMachine;

	constructor(machine: SetupMachine, areas: readonly SetupArea[]) {
		this.#areas = areas;
		this.#machine = machine;
	}

	/**
	 * What undoing area `id` would do: each done step it undoes, last first,
	 * with what that removes and what only the person can; the creds it
	 * forgets and those it keeps for a step still using them; the name to
	 * type when it destroys something costly; and why it cannot, if it cannot.
	 */
	async plan(id: string): Promise<UndoPlan> {
		const area = this.#area(id);
		const machine = this.#machine;
		const undone = await this.#undone(area);
		const keeps = await this.#keeps(undone);
		const kept = keptOf(keeps);
		const steps: StepUndoPlan[] = [];
		const refusals: string[] = [];
		let confirm: string | null = null;
		for (const step of undone) {
			const undo = step.undo;
			const refused = (await undo?.refused?.(machine)) ?? null;
			if (refused !== null) {
				refusals.push(refused);
			}
			confirm = confirm ?? (await undo?.confirm?.(machine)) ?? null;
			steps.push({
				id: step.id,
				title: step.title,
				removes: [...((await undo?.removes(machine, kept)) ?? [])],
				leaves: [...((await undo?.leaves?.(machine)) ?? [])],
			});
		}
		const needing = await this.#needing(area, undone);
		if (needing !== null) {
			refusals.unshift(needing);
		}
		return {
			area: area.id,
			title: area.title,
			steps,
			creds: await this.#creds(keeps),
			confirm,
			refused: refusals[0] ?? null,
		};
	}

	/**
	 * Undoes area `id`: runs each done step's undo, last first, then forgets
	 * the creds `undoPlan` says it forgets. Throws a `StepProblem` when the
	 * plan refuses, `confirm` is not the name it asks for, or a step's undo
	 * fails, which leaves the rest as they were, so undoing again goes on
	 * from there.
	 */
	async run(id: string, confirm: string | null): Promise<void> {
		const plan = await this.plan(id);
		if (plan.refused !== null) {
			throw new StepProblem(plan.refused);
		}
		if (plan.confirm !== null && confirm?.trim() !== plan.confirm) {
			throw new StepProblem(`Type ${plan.confirm} to undo ${plan.title}.`);
		}
		const area = this.#area(id);
		const undone = await this.#undone(area);
		const kept = keptOf(await this.#keeps(undone));
		for (const step of undone) {
			try {
				await step.undo?.run(this.#machine, kept);
			} catch (error) {
				throw new StepProblem(
					`Undoing "${step.title}" failed: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
		for (const cred of plan.creds) {
			if (cred.keptFor === null) {
				await this.#machine.device.delete(cred.name);
			}
		}
	}

	#area(id: string): SetupArea {
		const area = this.#areas.find((each) => each.id === id);
		if (area === undefined) {
			fail("not_found", `no setup area '${id}': \`splates setup\` lists them`, {
				area: id,
			});
		}
		return area;
	}

	/** `area`'s steps on the roster here that read done, last first. */
	async #undone(area: SetupArea): Promise<SetupStep[]> {
		const done: SetupStep[] = [];
		for (const step of area.steps) {
			if (
				(await listed(step, this.#machine)) &&
				(await checked(step, this.#machine)).done
			) {
				done.push(step);
			}
		}
		return done.reverse();
	}

	/** Why a done step of another area stops `undone` going, or null. */
	async #needing(
		area: SetupArea,
		undone: readonly SetupStep[],
	): Promise<string | null> {
		for (const other of this.#areas) {
			if (other === area) {
				continue;
			}
			for (const step of other.steps) {
				const needs = step.after.find((each) => undone.includes(each));
				if (
					needs !== undefined &&
					(await listed(step, this.#machine)) &&
					(await checked(step, this.#machine)).done
				) {
					return `Undo ${other.title} first: its "${step.title}" needs "${needs.title}".`;
				}
			}
		}
		return null;
	}

	/**
	 * What `undone` saved or chose that others share, the creds and the
	 * cloud chosen, each with what keeps it: a done step outside them that
	 * says it uses it, or something outside setup. A step that only asks for
	 * a cred keeps nothing, so two journeys that both ask for it let it go
	 * once both are undone.
	 */
	async #keeps(
		undone: readonly SetupStep[],
	): Promise<Map<string, string | null>> {
		const machine = this.#machine;
		const names = new Set(
			(await Promise.all(undone.map((step) => sharedOf(step, machine)))).flat(),
		);
		const others = this.#areas
			.flatMap((each) => each.steps)
			.filter((step) => !undone.includes(step));
		const keeps = new Map<string, string | null>();
		for (const name of names) {
			let keptFor: string | null = OUTSIDE[name] ?? null;
			for (const step of others) {
				if (keptFor !== null) {
					break;
				}
				if (
					(step.uses ?? []).includes(name) &&
					(await listed(step, machine)) &&
					(await checked(step, machine)).done
				) {
					keptFor = step.title;
				}
			}
			keeps.set(name, keptFor);
		}
		return keeps;
	}

	/** Those of `keeps` the device keeps as creds. */
	async #creds(keeps: Map<string, string | null>): Promise<UndoCred[]> {
		const creds: UndoCred[] = [];
		for (const [name, keptFor] of keeps) {
			if ((await this.#machine.device.get(name)) !== undefined) {
				creds.push({ name, keptFor });
			}
		}
		return creds;
	}
}

/**
 * Taking a done step back out. Its `run` passes over what is gone already,
 * so undoing again after a failure finishes the job.
 */
export interface StepUndo {
	/**
	 * What `run` removes, a line each, naming each thing, for the page to
	 * list first; `kept` names what others share that a step elsewhere
	 * still uses, as the cloud chosen, which it leaves.
	 */
	removes(
		machine: SetupMachine,
		kept?: ReadonlySet<string>,
	): Promise<readonly string[]>;
	/** What only the person can remove, a markdown line each with where to. */
	leaves?(machine: SetupMachine): Promise<readonly string[]>;
	/** Why it cannot be undone here now, or null. */
	refused?(machine: SetupMachine): Promise<string | null>;
	/** A name the person types to go ahead, for something costly to lose; none for null. */
	confirm?(machine: SetupMachine): Promise<string | null>;
	/**
	 * Removes what the step made, but what `kept` names, its creds still
	 * kept, which the area's undo forgets after.
	 */
	run(machine: SetupMachine, kept?: ReadonlySet<string>): Promise<void>;
}

/** What undoing an area would do, as `GET /api/setup/:area/undo` gives it. */
export interface UndoPlan {
	area: string;
	title: string;
	/** Each done step it undoes, last first. */
	steps: StepUndoPlan[];
	creds: UndoCred[];
	/** The name to type to go ahead, or null for none. */
	confirm: string | null;
	/** Why it cannot be undone now, or null. */
	refused: string | null;
}

export interface StepUndoPlan {
	id: string;
	title: string;
	removes: string[];
	leaves: string[];
}

/** A cred an undo would forget, unless `keptFor` names what still uses it. */
export interface UndoCred {
	name: string;
	keptFor: string | null;
}

/**
 * Creds kept on the device for something outside setup too, which undoing
 * the area that asked for them leaves.
 */
const OUTSIDE: Record<string, string> = {
	CLOUDFLARE_API_TOKEN: "scry's Workers AI",
	CLOUDFLARE_ACCOUNT_ID: "scry's Workers AI",
};

/** The names in `keeps` something still keeps. */
function keptOf(keeps: Map<string, string | null>): ReadonlySet<string> {
	return new Set(
		[...keeps].filter(([, keptFor]) => keptFor !== null).map(([name]) => name),
	);
}

/** The creds `step` asks for, and what it uses that others share. */
async function sharedOf(
	step: SetupStep,
	machine: SetupMachine,
): Promise<string[]> {
	// Fields that will not read ask for no cred.
	const fields = await fieldsIn(step, machine).catch(() => []);
	return [
		...fields.flatMap((field) => (field.kind === "cred" ? [field.name] : [])),
		...(step.uses ?? []),
	];
}
