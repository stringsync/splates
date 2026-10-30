import type {
	ShipBump,
	ShipGraph,
	ShipProject,
} from "@stringsync/splates-server/ship";
import {
	CHANGED,
	changedProjects,
} from "@stringsync/splates-server/ship/browser";
import { ShipIcon } from "lucide-react";
import { type JSX, useEffect, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { Checkbox } from "#web/components/ui/checkbox.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#web/components/ui/select.tsx";
import { Switch } from "#web/components/ui/switch.tsx";
import { Textarea } from "#web/components/ui/textarea.tsx";
import { shipGraph } from "./api";
import { startShip } from "./api/ship";
import { cn } from "./lib/utils";

type Choice = {
	bump: ShipBump;
	adopt: "mechanical" | "agent";
	instructions: string;
};

/** A pin that trails the version its project is at now. */
type Stale = { project: string; name: string; from: string; to: string };

const BUMPS: ShipBump[] = ["patch", "minor", "major"];

const BUMP_HINTS: Record<ShipBump, string> = {
	patch: "Patch: fixes only, nothing new for users.",
	minor: "Minor: new features that keep working code working.",
	major: "Major: breaking changes for users.",
};

/**
 * The plan for a ship: the projects as a tree of who pins whom, where each is
 * given Deps (update its dependencies), Ship (publish it), or both, then
 * started. `ship` is the project the page opened with picked, or `+changed`
 * for every changed one.
 */
export function ShipPlan({
	ship,
	endedAt,
	busy,
	loading,
	onStarted,
}: {
	ship: string | null;
	/** When the last cascade ended, so versions are read again after one. */
	endedAt: string | null;
	/** A ship is running or stopped, so another cannot start. */
	busy: boolean;
	/** The live ship state has not arrived yet. */
	loading: boolean;
	onStarted: () => void;
}): JSX.Element {
	const [graph, setGraph] = useState<ShipGraph | null>(null);
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		void endedAt;
		const refresh = () => shipGraph().then(setGraph, () => setFailed(true));
		void refresh();
		window.addEventListener("focus", refresh);
		return () => window.removeEventListener("focus", refresh);
	}, [endedAt]);
	if (graph === null) {
		return (
			<p role="status" className="text-muted-foreground text-sm">
				{failed ? "The projects did not load." : "Reading the projects…"}
			</p>
		);
	}
	const listed = graph.projects.filter(
		(each) => each.ship !== null || !each.private || each.uses.length > 0,
	);
	if (listed.length === 0) {
		return (
			<p className="text-muted-foreground text-sm">
				No project ships yet. One does once its splates.config.ts names a{" "}
				<code>ship</code> command.
			</p>
		);
	}
	// Shipping a project turns its Deps on and ships whoever pins it; either can be turned off.
	return (
		<Plan
			// Read again once a ship has ended, so the choices follow the new versions.
			key={endedAt ?? ""}
			graph={graph}
			projects={listed}
			ship={ship}
			busy={busy}
			loading={loading}
			onStarted={onStarted}
		/>
	);
}

function Plan({
	graph,
	projects,
	ship,
	busy,
	loading,
	onStarted,
}: {
	graph: ShipGraph;
	projects: ShipProject[];
	ship: string | null;
	busy: boolean;
	loading: boolean;
	onStarted: () => void;
}): JSX.Element {
	const changed = changedProjects(graph).map((each) => each.slug);
	const [roots, setRoots] = useState<string[]>(
		ship === null ? [] : ship === CHANGED ? changed : [ship],
	);
	const [excluded, setExcluded] = useState<string[]>([]);
	const [updating, setUpdating] = useState<string[]>(() =>
		projects
			.filter((each) => staleOf(each, graph).length > 0)
			.map((each) => each.slug),
	);
	const [skipped, setSkipped] = useState<string[]>([]);
	const [choices, setChoices] = useState<Record<string, Choice>>({});
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);

	// A shipped project's dependents ship after it, so they ship too.
	const ships = new Set<string>();
	const visit = (slug: string) => {
		const project = projects.find((each) => each.slug === slug);
		if (project === undefined || ships.has(slug) || excluded.includes(slug)) {
			return;
		}
		if (shippable(project)) {
			ships.add(slug);
		}
		for (const each of projects) {
			if (each.uses.some((use) => use.project === slug)) {
				visit(each.slug);
			}
		}
	};
	for (const root of roots) {
		visit(root);
	}
	const updates = new Set([
		...updating,
		...[...ships].filter((slug) => !skipped.includes(slug)),
	]);
	const choice = (slug: string): Choice =>
		choices[slug] ?? { bump: "patch", adopt: "mechanical", instructions: "" };
	const change = (slug: string, patch: Partial<Choice>) =>
		setChoices((current) => ({
			...current,
			[slug]: { ...choice(slug), ...patch },
		}));
	const setShip = (slug: string, on: boolean) => {
		setRoots(
			on
				? [...new Set([...roots, slug])]
				: roots.filter((each) => each !== slug),
		);
		setExcluded(
			on ? excluded.filter((each) => each !== slug) : [...excluded, slug],
		);
		if (on) {
			setSkipped(skipped.filter((each) => each !== slug));
		}
	};
	const setUpdate = (slug: string, on: boolean) => {
		setSkipped(
			on ? skipped.filter((each) => each !== slug) : [...skipped, slug],
		);
		setUpdating(
			on
				? [...new Set([...updating, slug])]
				: updating.filter((each) => each !== slug),
		);
	};
	const unshipped = changed.filter((slug) => !ships.has(slug));
	const ordered = releaseOrder(projects).filter(
		(each) => ships.has(each.slug) || updates.has(each.slug),
	);
	const summary = [
		updates.size > 0 ? `Update dependencies in ${updates.size}` : null,
		ships.size > 0 ? `ship ${ships.size}` : null,
	]
		.filter((part) => part !== null)
		.join(", ");
	return (
		<section aria-label="ship plan" className="flex flex-col gap-3">
			{unshipped.length > 0 && (
				<Button
					variant="outline"
					className="w-full"
					disabled={pending}
					onClick={() => {
						setRoots([...new Set([...roots, ...changed])]);
						setExcluded(excluded.filter((each) => !changed.includes(each)));
						setSkipped(skipped.filter((each) => !changed.includes(each)));
					}}
				>
					Include all changed
				</Button>
			)}
			<div className="-mb-2 flex justify-end gap-4 px-3 text-muted-foreground text-xs">
				<span className="w-9 text-center">Deps</span>
				<span className="w-9 text-center">Ship</span>
			</div>
			<ol
				aria-label="Ship graph"
				className="flex flex-col overflow-hidden rounded-lg border bg-card"
			>
				{treeOrder(projects).map(({ project: each, depth }) => {
					const stale = staleOf(each, graph);
					const shipping = ships.has(each.slug);
					const deps = updates.has(each.slug);
					const commits = each.changes?.commits ?? 0;
					const value = choice(each.slug);
					const idle =
						commits === 0 && stale.length === 0 && !shipping && !deps;
					return (
						<li
							key={each.slug}
							aria-label={each.slug}
							className={cn(
								"relative flex flex-col gap-2 border-b py-3 pr-3 last:border-b-0",
								idle && "py-2 opacity-50",
							)}
							style={{ paddingLeft: `${0.75 + depth * 1.5}rem` }}
						>
							{depth > 0 && (
								<span
									aria-hidden
									className="absolute top-0 h-[1.65rem] w-3 rounded-bl-md border-b-2 border-l-2 border-primary/30"
									style={{ left: `${0.75 + (depth - 1) * 1.5 + 0.4}rem` }}
								/>
							)}
							<div className="flex items-center gap-3">
								<div className="flex min-w-0 flex-1 flex-col gap-1">
									<span className="flex items-baseline gap-2">
										<span className="font-medium text-sm">{each.slug}</span>
										{each.version !== null && (
											<span className="text-muted-foreground text-xs tabular-nums">
												{each.version}
											</span>
										)}
									</span>
									<span className="flex flex-col text-xs">
										{each.changes?.commits === null && (
											<span
												className="text-muted-foreground"
												title={each.changes.error ?? undefined}
											>
												Release status unknown
											</span>
										)}
										{commits > 0 && (
											<span
												className="text-warning"
												title={`Since ${each.changes?.tag} on ${each.changes?.branch}`}
											>
												{commits} to ship
											</span>
										)}
										{stale.map((pin) => (
											<span key={pin.name} className="text-muted-foreground">
												{pin.name} {pin.from} → {pin.to}
											</span>
										))}
									</span>
								</div>
								<div className="flex shrink-0 gap-4">
									<span className="flex w-9 justify-center">
										<Checkbox
											aria-label={`Update dependencies of ${each.slug}`}
											checked={deps}
											disabled={pending}
											onCheckedChange={(on) => setUpdate(each.slug, on)}
										/>
									</span>
									<span className="flex w-9 justify-center">
										{shippable(each) ? (
											<Checkbox
												aria-label={`Ship ${each.slug}`}
												checked={shipping}
												disabled={pending}
												onCheckedChange={(on) => setShip(each.slug, on)}
											/>
										) : (
											!each.private && (
												<span className="text-muted-foreground text-xs">
													no ship
												</span>
											)
										)}
									</span>
								</div>
							</div>
							{(shipping || deps) && (
								<div className="flex flex-col gap-2 text-sm">
									<div className="flex flex-wrap items-center gap-4">
										{shipping && (
											<span className="flex items-center gap-2">
												<span className="text-muted-foreground">
													Release as
												</span>
												<Select
													items={BUMPS.map((bump) => ({
														value: bump,
														label: bump,
													}))}
													value={value.bump}
													disabled={pending}
													onValueChange={(bump) =>
														bump !== null &&
														change(each.slug, { bump: bump as ShipBump })
													}
												>
													<SelectTrigger
														aria-label={`${each.slug} version bump`}
													>
														<SelectValue />
													</SelectTrigger>
													<SelectContent>
														{BUMPS.map((bump) => (
															<SelectItem key={bump} value={bump}>
																{bump}
															</SelectItem>
														))}
													</SelectContent>
												</Select>
											</span>
										)}
										{deps && (
											<span className="flex items-center gap-2">
												<Switch
													size="sm"
													aria-label={`Agent task for ${each.slug}`}
													checked={value.adopt === "agent"}
													disabled={pending}
													onCheckedChange={(on) =>
														change(each.slug, {
															adopt: on ? "agent" : "mechanical",
														})
													}
												/>
												<span>Agent task</span>
											</span>
										)}
									</div>
									{shipping && (
										<p className="text-muted-foreground text-xs">
											{BUMP_HINTS[value.bump]}
										</p>
									)}
									{deps && value.adopt === "agent" && (
										<>
											<p className="text-muted-foreground text-xs">
												An agent moves the pins and fixes what breaks.
												{shipping &&
													" When its task merges, that tells splates it is OK to ship, and splates then publishes."}
											</p>
											<Textarea
												aria-label={`Instructions for ${each.slug}`}
												placeholder="Instructions for the agent"
												disabled={pending}
												value={value.instructions}
												onChange={(event) =>
													change(each.slug, {
														instructions: event.target.value,
													})
												}
											/>
										</>
									)}
								</div>
							)}
						</li>
					);
				})}
			</ol>
			<div className="sticky bottom-0 -mx-1 flex flex-col gap-2 bg-background/90 px-1 py-3 backdrop-blur">
				{error !== null && (
					<p role="alert" className="text-destructive text-xs">
						{error}
					</p>
				)}
				{busy && (
					<p role="status" className="text-muted-foreground text-xs">
						A ship is under way.
					</p>
				)}
				<p className="text-muted-foreground text-xs">
					{summary === "" ? "Nothing chosen" : summary}
				</p>
				<Button
					className="min-h-11 w-full"
					disabled={loading || busy || pending || ordered.length === 0}
					onClick={() => {
						setPending(true);
						setError(null);
						startShip({
							projects: ordered.map((each) => ({
								slug: each.slug,
								deps: updates.has(each.slug),
								ship: ships.has(each.slug),
								...choice(each.slug),
							})),
						}).then(
							() => {
								setPending(false);
								onStarted();
							},
							(reason: unknown) => {
								setPending(false);
								setError(String(reason));
							},
						);
					}}
				>
					<ShipIcon />
					{pending
						? "Starting…"
						: ships.size === 0 && updates.size > 0
							? "Update dependencies"
							: "Start"}
				</Button>
			</div>
		</section>
	);
}

const shippable = (each: ShipProject) => each.ship !== null && !each.private;

/**
 * `projects` with each after the first of its dependencies among them, as
 * the plan's tree reads top to bottom, so the list is in release order.
 */
function releaseOrder(projects: ShipProject[]): ShipProject[] {
	const slugs = new Set(projects.map((each) => each.slug));
	const seen = new Set<string>();
	const ordered: ShipProject[] = [];
	const visit = (project: ShipProject) => {
		if (seen.has(project.slug)) {
			return;
		}
		seen.add(project.slug);
		for (const use of project.uses) {
			const dependency = projects.find((each) => each.slug === use.project);
			if (dependency !== undefined && slugs.has(use.project)) {
				visit(dependency);
			}
		}
		ordered.push(project);
	};
	for (const each of projects) {
		visit(each);
	}
	return ordered;
}

/**
 * `projects` as a tree for display: each under the first project it pins,
 * so who depends on whom shows.
 */
function treeOrder(
	projects: ShipProject[],
): { project: ShipProject; depth: number }[] {
	const slugs = new Set(projects.map((each) => each.slug));
	const firstPinned = (project: ShipProject) =>
		project.uses
			.map((use) => use.project)
			.find((slug) => slugs.has(slug) && slug !== project.slug) ?? null;
	const rows: { project: ShipProject; depth: number }[] = [];
	const seen = new Set<string>();
	const visit = (parent: string | null, depth: number) => {
		for (const each of projects) {
			if (!seen.has(each.slug) && firstPinned(each) === parent) {
				seen.add(each.slug);
				rows.push({ project: each, depth });
				visit(each.slug, depth + 1);
			}
		}
	};
	visit(null, 0);
	return rows;
}

/** The pins of `project` that trail the version their project is at now. */
function staleOf(project: ShipProject, graph: ShipGraph): Stale[] {
	return project.uses.flatMap((use) => {
		const now = graph.projects.find(
			(each) => each.slug === use.project,
		)?.version;
		return now == null
			? []
			: use.pins
					.filter((pin) => pin.version !== now)
					.map((pin) => ({
						project: use.project,
						name: pin.name,
						from: pin.version,
						to: now,
					}));
	});
}
