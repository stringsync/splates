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

const BUMPS: ShipBump[] = ["patch", "minor", "major"];

/**
 * The ship plan: every project with whether it ships in this ship, in release
 * order, and Start at the foot. `ship` is the project the page opened with
 * picked, or `+changed` for every changed one.
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
	const [error, setError] = useState<string | null>(null);
	const [picked, setPicked] = useState<string[] | null>(null);
	const [excluded, setExcluded] = useState<string[]>([]);
	const [choices, setChoices] = useState<Record<string, Choice>>({});
	const [pending, setPending] = useState(false);
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
	const changed = changedProjects(graph).map((each) => each.slug);
	const roots =
		picked ?? (ship === null ? [] : ship === CHANGED ? changed : [ship]);
	const included = new Set<string>();
	const visit = (slug: string) => {
		if (included.has(slug) || excluded.includes(slug)) {
			return;
		}
		included.add(slug);
		for (const each of graph.projects) {
			if (each.uses.some((use) => use.project === slug)) {
				visit(each.slug);
			}
		}
	};
	for (const root of roots) {
		visit(root);
	}
	const shippable = (each: ShipProject) => each.ship !== null && !each.private;
	const ordered = releaseOrder(listed);
	const steps = ordered.filter(
		(each) => included.has(each.slug) && shippable(each),
	);
	const choice = (slug: string): Choice =>
		choices[slug] ?? { bump: "patch", adopt: "mechanical", instructions: "" };
	const update = (slug: string, patch: Partial<Choice>) =>
		setChoices((current) => ({
			...current,
			[slug]: { ...choice(slug), ...patch },
		}));
	const toggle = (slug: string, on: boolean) => {
		setPicked(on ? [...roots, slug] : roots.filter((each) => each !== slug));
		setExcluded(
			on ? excluded.filter((each) => each !== slug) : [...excluded, slug],
		);
	};
	const includeChanged = () => {
		setPicked([...new Set([...roots, ...changed])]);
		setExcluded(excluded.filter((each) => !changed.includes(each)));
	};
	return (
		<section aria-label="ship plan" className="flex flex-col gap-3">
			<div className="flex flex-col gap-3 rounded-lg border border-primary/25 bg-primary/5 p-3">
				<span className="flex flex-col">
					<span className="font-medium text-sm">
						{changed.length === 0
							? "Every project is up to date"
							: `${changed.length} project${changed.length === 1 ? " has" : "s have"} unshipped commits`}
					</span>
					<span className="text-muted-foreground text-xs">
						{changed.length === 0
							? "Nothing has changed since its last release."
							: `${changed.join(", ")}, with every project that pins them.`}
					</span>
				</span>
				<Button
					variant="outline"
					className="w-full"
					disabled={changed.length === 0 || pending}
					onClick={includeChanged}
				>
					Include all changed
				</Button>
			</div>
			<h2 className="mt-2 font-medium text-sm">Projects</h2>
			<ol
				aria-label="Ship graph"
				className="flex flex-col divide-y overflow-hidden rounded-lg border bg-card"
			>
				{ordered.map((each) => {
					const number = steps.indexOf(each) + 1;
					const value = choice(each.slug);
					return (
						<li
							key={each.slug}
							aria-label={each.slug}
							className={cn(
								"flex flex-col gap-3 px-3 py-2.5",
								number === 0 &&
									(each.changes?.commits ?? 1) === 0 &&
									"opacity-60",
							)}
						>
							<div className="flex items-center gap-3">
								<span
									aria-hidden
									className={cn(
										"flex size-6 shrink-0 items-center justify-center rounded-full text-xs tabular-nums",
										number > 0
											? "bg-primary text-primary-foreground"
											: "border text-muted-foreground",
									)}
								>
									{number > 0 ? number : ""}
								</span>
								<span className="flex min-w-0 flex-1 flex-col gap-0.5">
									<span className="flex items-baseline gap-2">
										<span className="font-medium text-sm">{each.slug}</span>
										{each.version !== null && (
											<span className="text-muted-foreground text-xs tabular-nums">
												{each.version}
											</span>
										)}
									</span>
									{each.changes !== undefined && (
										<Changes changes={each.changes} />
									)}
									<span className="truncate text-muted-foreground text-xs">
										{each.packages.length > 0
											? each.packages.join(", ")
											: "Takes the releases it pins"}
									</span>
								</span>
								{shippable(each) ? (
									<Switch
										aria-label={`Ship ${each.slug}`}
										checked={included.has(each.slug)}
										disabled={pending}
										onCheckedChange={(on) => toggle(each.slug, on)}
									/>
								) : (
									<span className="shrink-0 text-muted-foreground text-xs">
										{each.private ? "" : "no ship command"}
									</span>
								)}
							</div>
							{number > 0 && (
								<div className="flex flex-col gap-3 pl-9">
									<div className="flex flex-wrap items-center gap-4 text-sm">
										<Select
											items={BUMPS.map((bump) => ({
												value: bump,
												label: bump,
											}))}
											value={value.bump}
											disabled={pending}
											onValueChange={(bump) =>
												bump !== null &&
												update(each.slug, { bump: bump as ShipBump })
											}
										>
											<SelectTrigger aria-label={`${each.slug} version bump`}>
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
										<div className="flex items-center gap-2">
											<Switch
												size="sm"
												aria-label={`Agent task for ${each.slug}`}
												checked={value.adopt === "agent"}
												disabled={pending}
												onCheckedChange={(on) =>
													update(each.slug, {
														adopt: on ? "agent" : "mechanical",
													})
												}
											/>
											<span>Agent task</span>
										</div>
									</div>
									{value.adopt === "agent" && (
										<Textarea
											aria-label={`Instructions for ${each.slug}`}
											placeholder="Instructions for the agent"
											disabled={pending}
											value={value.instructions}
											onChange={(event) =>
												update(each.slug, { instructions: event.target.value })
											}
										/>
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
				<Button
					className="min-h-11 w-full"
					disabled={loading || busy || pending || steps.length === 0}
					onClick={() => {
						setPending(true);
						setError(null);
						startShip({
							projects: steps.map((each) => ({
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
						: steps.length === 0
							? "Start"
							: `Start ${steps.length} step${steps.length === 1 ? "" : "s"}`}
				</Button>
			</div>
		</section>
	);
}

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

/** Commits since the last release, as a dot and a short label. */
function Changes({
	changes,
}: {
	changes: NonNullable<ShipProject["changes"]>;
}): JSX.Element {
	const unshipped = changes.commits !== null && changes.commits > 0;
	return (
		<span
			className={cn(
				"flex items-center gap-1.5 text-xs",
				!unshipped && "text-muted-foreground",
			)}
			title={changes.error ?? `Since ${changes.tag} on ${changes.branch}`}
		>
			<span
				aria-hidden
				className={cn(
					"size-1.5 shrink-0 rounded-full",
					changes.commits === null
						? "bg-muted-foreground"
						: unshipped
							? "bg-warning"
							: "bg-success",
				)}
			/>
			{changes.commits === null
				? "Release status unknown"
				: changes.commits === 0
					? "Up to date"
					: `${changes.commits} unshipped`}
		</span>
	);
}
