import type { Bump, Listed, Pick, Unshipped } from "@splates/server/ship";
import type { JSX } from "react";
import { Checkbox } from "./components/ui/checkbox";
import { Input } from "./components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "./components/ui/toggle-group";
import { cn } from "./lib/utils";
import { BumpToggle } from "./ship-bump-toggle";

/**
 * What a picked target ships at: a bump, an exact `version` for a target
 * that takes artifact versions, or null for the target's own default (a
 * deploy that takes none, or a versioned target's default bump).
 */
export type Choice = Bump | { version: string } | null;

/** What is picked to ship: each target's name and its {@link Choice}. */
export type Picks = ReadonlyMap<string, Choice>;

/**
 * The choice a target is picked at first: its own bump or default, or an
 * empty version for a versioned target that resolves none by itself.
 */
export function firstChoice({ plan }: Listed): Choice {
	if (plan.versioned && plan.version === undefined && !plan.bump) {
		return { version: "" };
	}
	return plan.bump ?? null;
}

/** Whether every picked exact version has been typed in. */
export function chosen(picks: Picks): boolean {
	return [...picks.values()].every(
		(choice) =>
			choice === null ||
			typeof choice === "string" ||
			choice.version.trim() !== "",
	);
}

/** The picks as the plan and start routes take them. */
export function picksOf(picks: Picks): Pick[] {
	return [...picks].map(([name, choice]) =>
		choice === null
			? { name }
			: typeof choice === "string"
				? { name, bump: choice }
				: { name, version: choice.version.trim() },
	);
}

/**
 * Picks what to ship from every target, given as a flat list: tap a line to
 * pick it, and choose patch, minor or major on a picked one that takes a
 * bump. A picked versioned target switches between a bump and an exact
 * version, its control wrapping under the name on a narrow screen. Each
 * change comes back through `onPicks` as the whole pick. An unpicked target
 * shows its unshipped count once `unshipped` has it.
 */
export function ShipPickList({
	targets,
	unshipped = {},
	picks,
	onPicks,
	// vet-ignore objects-over-callbacks: a React component's props, which are how React passes events
}: {
	targets: readonly Listed[];
	unshipped?: Unshipped;
	picks: Picks;
	onPicks: (picks: Picks) => void;
}): JSX.Element {
	const toggle = (target: Listed) => {
		const next = new Map(picks);
		if (next.has(target.plan.name)) {
			next.delete(target.plan.name);
		} else {
			next.set(target.plan.name, firstChoice(target));
		}
		onPicks(next);
	};
	const choose = (name: string, to: Choice) => {
		onPicks(new Map(picks).set(name, to));
	};
	return (
		<ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
			{targets.map((target) => {
				const { name } = target.plan;
				const picked = picks.has(name);
				const choice = picks.get(name) ?? null;
				const versioned = target.plan.versioned === true;
				const deploy = target.plan.bump === undefined && !versioned;
				const count = unshipped[name];
				return (
					<li
						key={name}
						className="flex min-h-14 transition-colors hover:bg-muted/50 flex-wrap items-center gap-x-3 px-3.5"
					>
						<Checkbox
							checked={picked}
							onCheckedChange={() => toggle(target)}
							aria-label={name}
						/>
						{/* The name is the line's wide tap target; the checkbox is what a keyboard or reader uses. */}
						<span
							aria-hidden="true"
							onClick={() => toggle(target)}
							className={cn(
								"flex min-w-0 flex-1 cursor-pointer select-none items-center self-stretch py-3 text-sm",
								picked ? "font-semibold" : "font-medium",
							)}
						>
							<span className="truncate">{name}</span>
						</span>
						{!picked && count !== undefined && (
							<span
								className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground text-xs tabular-nums"
								title="Unshipped commits"
							>
								{count}
							</span>
						)}
						{deploy ? (
							<span className="text-muted-foreground text-xs">deploy</span>
						) : versioned ? (
							picked && (
								<VersionChoice
									target={target}
									choice={choice}
									onChoice={(to) => choose(name, to)}
								/>
							)
						) : (
							picked &&
							typeof choice === "string" && (
								<BumpToggle
									name={name}
									bump={choice}
									onBump={(to) => choose(name, to)}
								/>
							)
						)}
					</li>
				);
			})}
		</ul>
	);
}

const DEFAULT = "default";

/**
 * A versioned target's Bump | Version switch, then its bump or a version
 * field: on the row beside the name, or on a line of its own under it on a
 * narrow screen.
 */
function VersionChoice({
	target,
	choice,
	onChoice,
	// vet-ignore objects-over-callbacks: a React component's props, which are how React passes events
}: {
	target: Listed;
	choice: Choice;
	onChoice: (choice: Choice) => void;
}): JSX.Element {
	const { name, version } = target.plan;
	const exact = choice !== null && typeof choice === "object";
	return (
		<div className="flex w-full items-center gap-2 pb-3 pl-7 sm:w-auto sm:pb-0 sm:pl-0">
			<ToggleGroup
				aria-label={`${name}'s bump or version`}
				variant="outline"
				size="sm"
				spacing={0}
				value={[exact ? "version" : "bump"]}
				onValueChange={(value: string[]) => {
					const to = value[0];
					if (to === "version" && !exact) {
						onChoice({ version: "" });
					} else if (to === "bump" && exact) {
						onChoice(version === undefined ? "patch" : null);
					}
				}}
			>
				{(["bump", "version"] as const).map((each) => (
					<ToggleGroupItem
						key={each}
						value={each}
						className="data-pressed:bg-foreground data-pressed:text-background data-pressed:hover:bg-foreground data-pressed:hover:text-background pointer-coarse:h-9 pointer-coarse:px-3 pointer-coarse:text-sm"
					>
						{each === "bump" ? "Bump" : "Version"}
					</ToggleGroupItem>
				))}
			</ToggleGroup>
			{exact ? (
				<Input
					aria-label={`${name}'s version`}
					placeholder="version"
					value={choice.version}
					onChange={(event) => onChoice({ version: event.target.value })}
					className="h-7 min-w-0 flex-1 sm:w-28 sm:flex-none"
				/>
			) : (
				<BumpToggle
					name={name}
					bump={choice}
					// The target's own default bump, shown by the version it resolves to.
					{...(version !== undefined && {
						own: { value: DEFAULT, label: `default · ${version}` },
					})}
					onBump={(to) => onChoice(to)}
					className="min-w-0 flex-1 sm:flex-none"
				/>
			)}
		</div>
	);
}
