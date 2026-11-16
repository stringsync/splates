import type {
	ShipBump,
	ShipGraph,
	ShipProject,
} from "@splates/server/legacy-ship";
import { CHANGED, changedProjects } from "@splates/server/legacy-ship/browser";
import { ArrowLeftIcon, ShipIcon } from "lucide-react";
import { type JSX, type ReactNode, useEffect, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { Checkbox } from "#web/components/ui/checkbox.tsx";
import { shipGraph } from "./api";
import { startShip } from "./api/legacy-ship";
import { ShipBumpPicker } from "./legacy-ship-bump-picker";
import { type ShipChoice, ShipChoices } from "./legacy-ship-choices";
import {
	CommandCurrentIdentity,
	CommandLiveEvidence,
} from "./legacy-ship-command-evidence";
import { ProjectsHeader } from "./legacy-ship-plan-header";
import { PlanLoading } from "./legacy-ship-plan-loading";
import { ShipPreview } from "./legacy-ship-preview";
import { releaseOrder, shippable, staleOf } from "./legacy-ship-tree";
import { BUMPS, ShipVersions } from "./legacy-ship-versions";
import { cn } from "./lib/utils";

const shipChoices = new ShipChoices();

/**
 * Plan a ship: pick projects from the tree of who pins whom, then Start.
 * Pass `ship` to pre-pick a project, or `+changed` for every changed one.
 * Shows only Loading until `ready` and the projects have loaded.
 */
export function ShipPlan({
	ship,
	endedAt,
	busy,
	loading,
	ready = true,
	onStarted,
	lead,
	children,
}: {
	children?: ReactNode;
	/** Shown above the plan, and only once the plan has loaded. */
	lead?: ReactNode;
	/** Everything the page reads besides the projects has arrived. */
	ready?: boolean;
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
	if (graph === null || !ready) {
		return failed && graph === null ? (
			<p role="status" className="text-muted-foreground text-sm">
				The projects did not load.
			</p>
		) : (
			<PlanLoading />
		);
	}
	const listed = graph.projects.filter(
		(each) => each.ship !== null || !each.private || each.uses.length > 0,
	);
	if (listed.length === 0) {
		return (
			<>
				{lead}
				<p className="text-muted-foreground text-sm">
					No project ships yet. One does once its splates.config.ts names a{" "}
					<code>ship</code> command.
				</p>
				{children}
			</>
		);
	}
	return (
		<>
			{lead}
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
			{children}
		</>
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
	const [choices, setChoices] = useState<Record<string, ShipChoice>>({});
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const [reviewing, setReviewing] = useState(false);
	const [reviewGraph, setReviewGraph] = useState<ShipGraph | null>(null);

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
	// What a shipping project needs ships too, unless it is already current.
	const requiredBy = new Map<string, string[]>();
	for (const slug of [...ships]) {
		const project = projects.find((each) => each.slug === slug);
		for (const needed of project?.dependenciesClosure ?? []) {
			const target = projects.find((each) => each.slug === needed);
			if (
				target === undefined ||
				!shippable(target) ||
				target.changes?.commits === 0
			) {
				continue;
			}
			ships.add(needed);
			requiredBy.set(needed, [...(requiredBy.get(needed) ?? []), slug]);
		}
	}
	const choice = (slug: string): ShipChoice =>
		choices[slug] ?? { bump: "patch", adopt: "mechanical", instructions: "" };
	const change = (slug: string, patch: Partial<ShipChoice>) =>
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
	};
	const selectable = projects.filter(shippable).map((each) => each.slug);
	const allShip =
		selectable.length > 0 && selectable.every((slug) => ships.has(slug));
	const setAll = (on: boolean) => {
		setRoots(on ? selectable : []);
		setExcluded(on ? [] : selectable);
	};
	const unshipped = changed.filter((slug) => !ships.has(slug));
	const ordered = releaseOrder(projects).filter((each) => ships.has(each.slug));
	const behind = projects.filter(
		(each) => staleOf(each, graph).length > 0,
	).length;
	const versions = new ShipVersions(reviewGraph?.projects ?? projects);
	const inputsOf = (project: ShipProject) =>
		shipChoices.inputs(project, choice(project.slug));
	const reviewed = ordered.map(
		(project) =>
			reviewGraph?.projects.find((each) => each.slug === project.slug) ??
			project,
	);
	const versionAfter = (slug: string) =>
		versions.after(slug, choice(slug).bump);
	return (
		<section aria-label="ship plan" className="flex flex-col gap-3">
			{!reviewing && (
				<>
					{busy && (
						<p role="status" className="text-muted-foreground text-xs">
							You can plan the next ship once this one ends.
						</p>
					)}
					<div
						aria-disabled={busy || undefined}
						className={cn(
							"flex flex-col",
							busy && "pointer-events-none opacity-45",
						)}
					>
						<ProjectsHeader
							changed={changed.length}
							behind={behind}
							disabled={busy || pending || selectable.length === 0}
							canPickChanged={changed.length > 0 && unshipped.length > 0}
							allPicked={allShip}
							nonePicked={ships.size === 0}
							pickChanged={() => {
								setRoots([...new Set([...roots, ...changed])]);
								setExcluded(excluded.filter((each) => !changed.includes(each)));
							}}
							pickAll={() => setAll(true)}
							clear={() => setAll(false)}
						/>
						<ol
							aria-label="Ship graph"
							className="flex flex-col overflow-hidden rounded-b-lg border bg-card"
						>
							{releaseOrder(projects).map((each) => {
								const stale = staleOf(each, graph);
								const shipping = ships.has(each.slug);
								const commits = each.changes?.commits ?? 0;
								const value = choice(each.slug);
								const bumpInput = each.commandPlan?.inputs.find(
									(input) => input.name === "bump" && input.type === "choice",
								);
								const bumpOptions =
									bumpInput?.type === "choice"
										? bumpInput.options
										: each.commandPlan === undefined &&
												each.deploy !== true &&
												each.resuming === undefined
											? BUMPS
											: undefined;
								const bumpValue = String(
									bumpInput === undefined
										? value.bump
										: (inputsOf(each).bump ?? bumpInput.default),
								);
								const idle =
									commits === 0 &&
									each.changes?.commits !== null &&
									stale.length === 0 &&
									!shipping;
								return (
									<li
										key={each.slug}
										aria-label={each.slug}
										className={cn(
											"flex flex-col gap-2 border-b px-3 py-3 last:border-b-0",
											idle && "py-2 opacity-50",
											shipping && "bg-primary/5",
										)}
									>
										<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
											<div className="flex shrink-0 gap-4">
												<span className="flex w-9 justify-center">
													{shippable(each) ? (
														<Checkbox
															aria-label={`Ship ${each.slug}`}
															checked={shipping}
															disabled={pending || requiredBy.has(each.slug)}
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
											<div className="flex min-w-[10rem] flex-1 flex-col gap-1">
												<span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
													<span className="break-all font-medium text-sm">
														{each.slug}
													</span>
													<CommandCurrentIdentity project={each} />
													{each.changes?.commits === null && (
														<span
															className="whitespace-nowrap rounded-full bg-muted px-2 text-muted-foreground text-xs"
															title={each.changes.error ?? undefined}
														>
															status unknown
														</span>
													)}
													{commits > 0 && (
														<span
															className="whitespace-nowrap rounded-full bg-warning/15 px-2 text-warning text-xs"
															title={
																each.changes?.tag == null
																	? `Never deployed; every commit on ${each.changes?.branch}`
																	: `Since ${each.changes.tag} on ${each.changes?.branch}`
															}
														>
															{commits} {commits === 1 ? "commit" : "commits"}
														</span>
													)}
													{each.changes?.commits === 0 && (
														<span className="whitespace-nowrap rounded-full bg-success/15 px-2 text-success text-xs">
															up to date
														</span>
													)}
													{each.deploy === true && (
														<span className="whitespace-nowrap rounded-full bg-muted px-2 text-muted-foreground text-xs">
															deploy
														</span>
													)}
													{shipping &&
														!roots.includes(each.slug) &&
														!requiredBy.has(each.slug) && (
															<span className="whitespace-nowrap rounded-full bg-success/15 px-2 text-success text-xs">
																added automatically
															</span>
														)}
												</span>
												<span className="flex flex-col text-xs">
													{(each.dependencies ?? []).length > 0 && (
														<span className="text-muted-foreground">
															Depends on {(each.dependencies ?? []).join(", ")}
														</span>
													)}
													{requiredBy.has(each.slug) && (
														<span className="text-muted-foreground">
															Required by{" "}
															{requiredBy.get(each.slug)?.join(", ")}
														</span>
													)}
													{each.commandPlan?.resuming === true && (
														<span className="text-muted-foreground">
															{each.commandPlan.identity.from} →{" "}
															{each.commandPlan.identity.to} · finishing
															interrupted release
														</span>
													)}
													{each.resuming !== undefined && (
														<span className="text-muted-foreground">
															Finishes {each.resuming}, which stopped partway.
														</span>
													)}
													{stale.map((pin) => (
														<span
															key={pin.name}
															className="text-muted-foreground"
														>
															{pin.name} {pin.from} → {pin.to}
														</span>
													))}
												</span>
											</div>
											{bumpOptions !== undefined &&
												(commits !== 0 || shipping) && (
													<ShipBumpPicker
														slug={each.slug}
														options={bumpOptions}
														value={bumpValue}
														dimmed={!shipping}
														disabled={pending}
														onChange={(bump) =>
															bumpInput === undefined
																? change(each.slug, { bump: bump as ShipBump })
																: change(each.slug, {
																		inputs: { ...inputsOf(each), bump },
																	})
														}
													/>
												)}
										</div>
										<CommandLiveEvidence project={each} />
									</li>
								);
							})}
						</ol>
					</div>
				</>
			)}
			<div className="sticky bottom-0 -mx-1 flex flex-col gap-2 bg-background/90 px-1 py-3 backdrop-blur">
				{error !== null && (
					<p role="alert" className="text-destructive text-xs">
						{error}
					</p>
				)}
				{reviewing && ordered.length > 0 && (
					<ShipPreview
						ordered={reviewed}
						inputsOf={inputsOf}
						shipsAll={ships}
						versionAfter={versionAfter}
						bumpOf={(slug) => choice(slug).bump}
						adoptOf={(slug) => choice(slug).adopt}
					/>
				)}
				{!reviewing && !busy && ordered.length === 0 && (
					<p className="text-muted-foreground text-xs">Nothing chosen</p>
				)}
				{reviewing ? (
					<div className="flex gap-2">
						<Button
							variant="outline"
							className="min-h-11"
							disabled={pending}
							onClick={() => setReviewing(false)}
						>
							<ArrowLeftIcon />
							Back
						</Button>
						<Button
							className="min-h-11 flex-1"
							disabled={loading || busy || pending || ordered.length === 0}
							onClick={() => {
								setPending(true);
								setError(null);
								startShip({
									projects: shipChoices.selection(ordered, choice),
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
							{pending ? "Starting…" : "Accept and start ship"}
						</Button>
					</div>
				) : (
					<Button
						className="min-h-11 w-full"
						disabled={busy || pending || ordered.length === 0}
						onClick={() => {
							setError(null);
							if (!ordered.some((each) => each.commandPlan !== undefined)) {
								setReviewing(true);
								return;
							}
							setPending(true);
							void shipChoices
								.review(ordered, choice)
								.then(
									(graph) => {
										setReviewGraph(graph);
										setReviewing(true);
									},
									(error) => setError(String(error)),
								)
								.finally(() => setPending(false));
						}}
					>
						{busy
							? "A ship is running"
							: ordered.length > 0
								? `Review ${ordered.length} ${ordered.length === 1 ? "project" : "projects"}`
								: "Choose a project to ship"}
					</Button>
				)}
			</div>
		</section>
	);
}
