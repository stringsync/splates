import type { Listed, Listing, ShipCommands, Unshipped } from "./commands";
import { ComposeError } from "./compose-error";
import { waves } from "./waves";
import type { Bump, PlannedStep } from "./wire";

/**
 * A target picked to ship, at a bump or its own default, or, for a target
 * that takes artifact versions, at an exact `version`.
 */
export type Pick = {
	name: string;
	bump?: Bump;
	version?: string;
	/** Ships at the version the target's followed dependency releases. */
	follow?: true;
};

/** A picked target in the composed plan. */
export type ComposedTarget = {
	name: string;
	command: string;
	bump?: Bump;
	/**
	 * The exact version it ships, as its command resolved the pick; the run
	 * passes it to every step in place of the bump.
	 */
	version?: string;
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
		// Counted alongside, and used only when in by the time the plans are.
		let counts: Unshipped = {};
		void this.commands.unshipped().then(
			(each) => {
				counts = each;
			},
			() => {},
		);
		const { listing, listed } = await this.check(picks);
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
		const pickByName = new Map(picks.map((pick) => [pick.name, pick]));
		const planned = new Map<string, ComposedTarget>();
		const resolvedVersion = new Map<string, string>();
		// Plan wave by wave so a dependent receives the version each earlier
		// dependency resolved as `--upstream <name>=<version>`, including
		// through chained followers.
		for (const wave of order) {
			const built = await Promise.all(
				wave.map(async (name) => {
					const pick = pickByName.get(name) as Pick;
					const entry = listed.get(name) as Listed;
					const upstream: Record<string, string> = {};
					for (const dep of entry.plan.dependencies) {
						const version = resolvedVersion.get(dep);
						if (version !== undefined) {
							upstream[dep] = version;
						}
					}
					return [
						name,
						pick,
						entry,
						await this.planned(pick, entry, upstream),
					] as const;
				}),
			);
			for (const [name, pick, entry, target] of built) {
				planned.set(name, target);
				if (target.error === undefined) {
					const version =
						target.version ??
						(pick.follow && entry.plan.follows !== undefined
							? resolvedVersion.get(entry.plan.follows)
							: undefined);
					if (version !== undefined) {
						resolvedVersion.set(name, version);
					}
				}
			}
		}
		return {
			waves: order,
			targets: order.flat().map((name) => planned.get(name) as ComposedTarget),
			offered: offeredFor(picks, listing, counts),
			errors: listing.errors,
		};
	}

	/**
	 * Refuses picks no ship could start (an unknown or doubled target, a
	 * version or bump the target does not take), planning nothing: the
	 * refusal `compose` gives.
	 */
	async check(picks: readonly Pick[]): Promise<{
		listing: Awaited<ReturnType<ShipCommands["list"]>>;
		listed: Map<string, Listed>;
	}> {
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
			if (pick.follow && found.plan.follows === undefined) {
				throw new ComposeError(`"${pick.name}" follows nothing`);
			}
			if (pick.follow && (pick.version !== undefined || pick.bump)) {
				throw new ComposeError(
					`"${pick.name}" follows, so takes no version or bump`,
				);
			}
			if (pick.version !== undefined && !found.plan.versioned) {
				throw new ComposeError(`"${pick.name}" takes no version`);
			}
			if (pick.version !== undefined && pick.bump) {
				throw new ComposeError(
					`"${pick.name}" takes a version or a bump, not both`,
				);
			}
			if (pick.bump && !found.plan.bump && !found.plan.versioned) {
				throw new ComposeError(`"${pick.name}" takes no bump`);
			}
		}
		return { listing, listed };
	}

	/** `pick` planned again at its version or bump, or with why its command could not. */
	private async planned(
		pick: Pick,
		{ command, plan }: Listed,
		upstream: Record<string, string>,
	): Promise<ComposedTarget> {
		const bump =
			pick.version === undefined && !pick.follow
				? (pick.bump ?? plan.bump)
				: undefined;
		const base = {
			name: pick.name,
			command,
			...(bump && { bump }),
			dependencies: plan.dependencies,
		};
		try {
			const again = await this.commands.plan(command, pick.name, {
				...(bump && { bump }),
				...(pick.version !== undefined && { version: pick.version }),
				...(Object.keys(upstream).length > 0 && { upstream }),
			});
			// A follower takes the version its dependency releases in this ship.
			if (plan.versioned && again.version === undefined && !pick.follow) {
				throw new Error("Choose a version or a bump");
			}
			return {
				...base,
				...(again.version !== undefined && { version: again.version }),
				dependencies: again.dependencies,
				steps: again.steps,
				waves: waves(again.steps, "step"),
			};
		} catch (error) {
			return { ...base, steps: [], waves: [], error: (error as Error).message };
		}
	}
}

/**
 * Every target the picks depend on, directly or through another, unpicked
 * and not counted as having nothing unshipped.
 */
function offeredFor(
	picks: readonly Pick[],
	listing: Listing,
	unshipped: Unshipped,
): Offered[] {
	const dependenciesOf = new Map(
		listing.targets.map((each) => [each.plan.name, each.plan.dependencies]),
	);
	const picked = new Set(picks.map((pick) => pick.name));
	const offered = new Map<string, Offered>();
	const visit = (name: string): void => {
		for (const dependency of dependenciesOf.get(name) ?? []) {
			if (picked.has(dependency)) {
				continue;
			}
			// Nothing waiting to ship: what is already out serves the dependents.
			if (unshipped[dependency] === 0) {
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
