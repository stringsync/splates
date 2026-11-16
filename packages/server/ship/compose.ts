import type { Listed, Listing, ShipCommands } from "./commands";
import { ComposeError } from "./compose-error";
import { waves } from "./waves";
import type { Bump, PlannedStep } from "./wire";

/** A target picked to ship, at a bump or its own default. */
export type Pick = { name: string; bump?: Bump };

/** A picked target in the composed plan. */
export type ComposedTarget = {
	name: string;
	command: string;
	bump?: Bump;
	dependencies: string[];
	steps: PlannedStep[];
	/** The step ids in the order they run, each wave's steps in parallel. */
	waves: string[][];
	/** Why its command could not plan it at this bump; it then has no steps. */
	error?: string;
};

/** A target the picks depend on that was not picked, offered to add. */
export type Offered = {
	name: string;
	/** The targets, picked or offered, that depend on it. */
	for: string[];
	/** Set when no registered command serves it. */
	error?: string;
};

/** One ship of the picked targets, ready for the review screen. */
export type Composed = {
	/** The picked targets in the order they ship, each wave's in parallel. */
	waves: string[][];
	targets: ComposedTarget[];
	offered: Offered[];
	/** Commands that could not answer `plan` at all. */
	errors: Listing["errors"];
};

/** Composes picked targets of the registered ship commands into one plan. */
export class ShipComposer {
	constructor(private readonly commands: ShipCommands) {}

	async compose(picks: readonly Pick[]): Promise<Composed> {
		const listing = await this.commands.list();
		const listed = new Map(
			listing.targets.map((each) => [each.plan.name, each]),
		);
		const seen = new Set<string>();
		for (const pick of picks) {
			const found = listed.get(pick.name);
			if (found === undefined) {
				throw new ComposeError(`No ship command serves "${pick.name}"`);
			}
			if (seen.has(pick.name)) {
				throw new ComposeError(`"${pick.name}" is picked twice`);
			}
			seen.add(pick.name);
			if (pick.bump && !found.plan.bump) {
				throw new ComposeError(`"${pick.name}" takes no bump`);
			}
		}
		let order: string[][];
		try {
			order = waves(
				picks.map((pick) => ({
					id: pick.name,
					dependencies: listed.get(pick.name)?.plan.dependencies,
				})),
				"target",
			);
		} catch (error) {
			throw new ComposeError((error as Error).message);
		}
		const planned = new Map(
			await Promise.all(
				picks.map(
					async (pick) =>
						[
							pick.name,
							await this.planned(pick, listed.get(pick.name) as Listed),
						] as const,
				),
			),
		);
		return {
			waves: order,
			targets: order.flat().map((name) => planned.get(name) as ComposedTarget),
			offered: offeredFor(picks, listing),
			errors: listing.errors,
		};
	}

	/** `pick` planned again at its bump, or with why its command could not. */
	private async planned(
		pick: Pick,
		{ command, plan }: Listed,
	): Promise<ComposedTarget> {
		const bump = pick.bump ?? plan.bump;
		const base = {
			name: pick.name,
			command,
			...(bump && { bump }),
			dependencies: plan.dependencies,
		};
		try {
			const again = await this.commands.plan(command, pick.name, bump);
			return {
				...base,
				dependencies: again.dependencies,
				steps: again.steps,
				waves: waves(again.steps, "step"),
			};
		} catch (error) {
			return { ...base, steps: [], waves: [], error: (error as Error).message };
		}
	}
}

/** Every target the picks depend on, directly or through another, unpicked and with changes unshipped. */
function offeredFor(picks: readonly Pick[], listing: Listing): Offered[] {
	const dependenciesOf = new Map(
		listing.targets.map((each) => [each.plan.name, each.plan.dependencies]),
	);
	const unshipped = new Map(
		listing.targets.map((each) => [each.plan.name, each.plan.unshipped]),
	);
	const picked = new Set(picks.map((pick) => pick.name));
	const offered = new Map<string, Offered>();
	const visit = (name: string): void => {
		for (const dependency of dependenciesOf.get(name) ?? []) {
			if (picked.has(dependency)) {
				continue;
			}
			// Nothing waiting to ship: what is already out serves the dependents.
			if (unshipped.get(dependency) === 0) {
				continue;
			}
			const known = offered.get(dependency);
			if (known !== undefined) {
				if (!known.for.includes(name)) {
					known.for.push(name);
				}
				continue;
			}
			offered.set(dependency, {
				name: dependency,
				for: [name],
				...(!dependenciesOf.has(dependency) && {
					error: `No ship command serves "${dependency}"`,
				}),
			});
			visit(dependency);
		}
	};
	for (const pick of picks) {
		visit(pick.name);
	}
	return [...offered.values()];
}
