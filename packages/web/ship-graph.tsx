import type { ShipGraph, ShipProject } from "@stringsync/splates-server/ship";
import { changedProjects } from "@stringsync/splates-server/ship/browser";
import { ShipIcon } from "lucide-react";
import { type JSX, useEffect, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { shipGraph } from "./api";
import { cn } from "./lib/utils";

/**
 * The registered projects that ship or take a release, in one list in
 * release order, each after the projects whose packages it pins; Ship picks
 * it, and nothing ships until its plan is approved in the conversation that
 * starts. Above it, one pick of every project changed since its last release.
 */
export function ShipGraphTree({
	endedAt,
	onShip,
	onShipChanged,
}: {
	/** When the last cascade ended, so versions are read again after one. */
	endedAt: string | null;
	onShip: (slug: string) => void;
	/** Picks every changed project, by slug, to ship. */
	onShipChanged: (changed: string[]) => void;
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
	const shipping = graph.projects.filter(
		(each) => each.ship !== null || !each.private || each.uses.length > 0,
	);
	if (shipping.length === 0) {
		return (
			<p className="text-muted-foreground text-sm">
				No project ships yet. One does once its splates.config.ts names a{" "}
				<code>ship</code> command.
			</p>
		);
	}
	return (
		<section aria-label="projects" className="flex flex-col gap-3">
			<ShipChanged
				changed={changedProjects(graph).map((each) => each.slug)}
				onShip={onShipChanged}
			/>
			<h2 className="mt-2 font-medium text-sm">Projects</h2>
			<ol
				aria-label="Ship graph"
				className="flex flex-col divide-y overflow-hidden rounded-lg border bg-card"
			>
				{releaseOrder(shipping).map((each) => (
					<GraphProject
						key={each.slug}
						project={each}
						onShip={() => onShip(each.slug)}
					/>
				))}
			</ol>
		</section>
	);
}

/**
 * `projects` with each after the first of its dependencies among them, as
 * the plan's tree reads top to bottom, so the list is in release order.
 */
function releaseOrder(projects: ShipProject[]): ShipProject[] {
	const slugs = new Set(projects.map((each) => each.slug));
	const parentOf = (project: ShipProject) =>
		project.uses
			.map((use) => use.project)
			.find((slug) => slugs.has(slug) && slug !== project.slug) ?? null;
	const ordered: ShipProject[] = [];
	const visit = (parent: string | null) => {
		for (const each of projects) {
			if (parentOf(each) === parent) {
				ordered.push(each);
				visit(each.slug);
			}
		}
	};
	visit(null);
	return ordered;
}

/** The pick of every changed project, naming them, or saying none changed. */
function ShipChanged({
	changed,
	onShip,
}: {
	changed: string[];
	onShip: (changed: string[]) => void;
}): JSX.Element {
	return (
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
						: `${changed.join(", ")}, released dependencies first, then what depends on them.`}
				</span>
			</span>
			<Button
				className="w-full"
				disabled={changed.length === 0}
				title="Picks every changed project, in dependency order; nothing ships until you approve its plan"
				onClick={() => onShip(changed)}
			>
				<ShipIcon />
				{changed.length === 1
					? `Ship ${changed[0]}`
					: changed.length === 0
						? "Ship all changed"
						: `Ship all ${changed.length}`}
			</Button>
		</div>
	);
}

function GraphProject({
	project,
	onShip,
}: {
	project: ShipProject;
	onShip: () => void;
}): JSX.Element {
	const shipped = project.ship !== null;
	return (
		<li
			aria-label={project.slug}
			className="flex items-center gap-3 px-3 py-2.5"
		>
			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="flex items-baseline gap-2">
					<span className="font-medium text-sm">{project.slug}</span>
					{project.version !== null && (
						<span className="text-muted-foreground text-xs tabular-nums">
							{project.version}
						</span>
					)}
				</span>
				{project.changes !== undefined && <Changes changes={project.changes} />}
				<span className="truncate text-muted-foreground text-xs">
					{project.packages.length > 0
						? project.packages.join(", ")
						: "Takes the releases it pins"}
				</span>
			</span>
			{shipped ? (
				<Button
					size="sm"
					variant="outline"
					title="Picks it to ship, downstream too; nothing ships until you approve its plan"
					onClick={onShip}
				>
					Ship
				</Button>
			) : (
				<span className="shrink-0 text-muted-foreground text-xs">
					{project.private ? "" : "no ship command"}
				</span>
			)}
		</li>
	);
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
