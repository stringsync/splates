import type { ShipBump, ShipGraph, ShipProject } from "@splates/server/ship";
import {
	CHANGED,
	changedProjects,
	nextVersion,
} from "@splates/server/ship/browser";
import { ShipIcon } from "lucide-react";
import { type JSX, type ReactNode, useEffect, useState } from "react";
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
import { PlanLoading } from "./ship-plan-loading";
import { ShipPreview } from "./ship-preview";
import { releaseOrder, shippable, staleOf, treeOrder } from "./ship-tree";

type Choice = {
	bump: ShipBump;
	adopt: "mechanical" | "agent";
	instructions: string;
};

const BUMPS: ShipBump[] = ["patch", "minor", "major"];

const BUMP_HINTS: Record<ShipBump, string> = {
	patch: "Patch: fixes only, nothing new for users.",
	minor: "Minor: new features that keep working code working.",
	major: "Major: breaking changes for users.",
};

/**
 * The plan for a ship: the projects as a tree of who pins whom, where each is
 * given a Ship checkbox, then started; shipping a project moves its
 * dependents' pins to the version released, and ships them too. `ship` is the project the page opened with picked, or `+changed`
 * for every changed one.
 */
export function ShipPlan({
	ship,
	endedAt,
	busy,
	loading,
	onStarted,
	children,
}: {
	children?: ReactNode;
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
		return failed ? (
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
	const versionAfter = (slug: string) => {
		const project = projects.find((each) => each.slug === slug);
		return project?.version == null
			? null
			: nextVersion(project.version, choice(slug).bump);
	};
	return (
		<section aria-label="ship plan" className="flex flex-col gap-3">
			{behind > 0 && (
				<p className="text-muted-foreground text-xs">{behind} behind a pin</p>
			)}

			<div className="-mb-2 flex items-center justify-end gap-4 px-3 text-muted-foreground text-xs">
				<span className="flex items-center gap-2">
					All changed
					<Checkbox
						aria-label="All changed"
						checked={changed.length > 0 && unshipped.length === 0}
						disabled={pending || changed.length === 0}
						onCheckedChange={(on) => {
							setRoots(
								on
									? [...new Set([...roots, ...changed])]
									: roots.filter((each) => !changed.includes(each)),
							);
							setExcluded(
								on
									? excluded.filter((each) => !changed.includes(each))
									: [...new Set([...excluded, ...changed])],
							);
						}}
					/>
				</span>
				<span className="flex items-center gap-2">
					Select all
					<span className="flex w-9 justify-center">
						<Checkbox
							aria-label="Select all"
							checked={allShip}
							disabled={pending || selectable.length === 0}
							onCheckedChange={setAll}
						/>
					</span>
				</span>
			</div>
			<ol
				aria-label="Ship graph"
				className="flex flex-col overflow-hidden rounded-lg border bg-card"
			>
				{treeOrder(projects).map(({ project: each, depth }) => {
					const stale = staleOf(each, graph);
					const shipping = ships.has(each.slug);
					const commits = each.changes?.commits ?? 0;
					const value = choice(each.slug);
					const idle =
						commits === 0 &&
						each.changes?.commits !== null &&
						stale.length === 0 &&
						!shipping;
					const adopts = shipping;
					return (
						<li
							key={each.slug}
							aria-label={each.slug}
							className={cn(
								"relative flex flex-col gap-2 border-b py-3 pr-3 last:border-b-0",
								idle && "py-2 opacity-50",
								shipping && "bg-primary/5",
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
										{each.deploy === true && (
											<span className="rounded-full bg-muted px-2 text-muted-foreground text-xs">
												deploy
											</span>
										)}
										{shipping && !roots.includes(each.slug) && (
											<span className="rounded-full bg-success/15 px-2 text-success text-xs">
												added automatically
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
												{commits} {commits === 1 ? "commit" : "commits"} since{" "}
												{each.changes?.tag}
											</span>
										)}
										{idle && each.changes?.commits === 0 && (
											<span className="text-muted-foreground">Up to date</span>
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
							{/* The room is kept while unchecked, so ticking a box never moves the rows below it. */}
							<div className={cn("text-sm", shippable(each) && "min-h-14")}>
								{!shipping && shippable(each) && (
									<p className="text-muted-foreground text-xs">
										Tick to include in this ship.
									</p>
								)}
								{shipping && (
									<div className="flex flex-col gap-2">
										<div className="flex flex-wrap items-center gap-4">
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
											{adopts && (
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
										<p className="text-muted-foreground text-xs">
											{BUMP_HINTS[value.bump]}
										</p>
										{adopts && value.adopt === "agent" && (
											<>
												<p className="text-muted-foreground text-xs">
													An agent moves the pins and fixes what breaks. When
													its task merges, that tells splates it is OK to ship,
													and splates then publishes.
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
							</div>
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
				{ordered.length > 0 ? (
					<ShipPreview
						ordered={ordered}
						shipsAll={ships}
						versionAfter={versionAfter}
					/>
				) : (
					<p className="text-muted-foreground text-xs">Nothing chosen</p>
				)}
				<Button
					className="min-h-11 w-full"
					disabled={loading || busy || pending || ordered.length === 0}
					onClick={() => {
						setPending(true);
						setError(null);
						startShip({
							projects: ordered.map((each) => ({
								slug: each.slug,
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
						: ordered.length > 0
							? `Ship ${ordered.length} ${ordered.length === 1 ? "project" : "projects"}`
							: "Choose a project to ship"}
				</Button>
			</div>
		</section>
	);
}
