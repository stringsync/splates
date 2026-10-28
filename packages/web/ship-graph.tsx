import type { ShipGraph, ShipProject } from "@stringsync/splates-server/ship";
import { changedProjects } from "@stringsync/splates-server/ship/browser";
import { PackageIcon } from "lucide-react";
import { type JSX, useEffect, useState } from "react";
import { Badge } from "#web/components/ui/badge.tsx";
import { Button } from "#web/components/ui/button.tsx";
import { shipGraph } from "./api";
import { cn } from "./lib/utils";
import { ShipTree } from "./ship-tree";

/**
 * The registered projects that ship or take a release, as a tree, each
 * beneath the project whose packages it pins first; Ship opens its plan.
 * Above it, one Ship for every project changed since its last release.
 */
export function ShipGraphTree({
	endedAt,
	onShip,
	onShipChanged,
}: {
	/** When the last cascade ended, so versions are read again after one. */
	endedAt: string | null;
	onShip: (slug: string) => void;
	/** Opens the plan to ship every changed project. */
	onShipChanged: () => void;
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
		<section aria-label="projects" className="flex flex-col gap-2">
			<ShipChanged
				changed={changedProjects(graph).map((each) => each.slug)}
				onShip={onShipChanged}
			/>
			<h2 className="font-medium text-sm">Projects</h2>
			<ShipTree
				label="Ship graph"
				items={shipping}
				slugOf={(each) => each.slug}
				dependenciesOf={(each) => each.uses.map((use) => use.project)}
				render={(each) => (
					<GraphProject project={each} onShip={() => onShip(each.slug)} />
				)}
			/>
		</section>
	);
}

/** The Ship for every changed project, naming them, or saying none changed. */
function ShipChanged({
	changed,
	onShip,
}: {
	changed: string[];
	onShip: () => void;
}): JSX.Element {
	return (
		<div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/25 bg-primary/5 p-3">
			<span className="flex min-w-0 flex-1 flex-col">
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
				disabled={changed.length === 0}
				title="Shows the plan for every changed project, in dependency order, before anything runs"
				onClick={onShip}
			>
				<PackageIcon />
				Ship all changed
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
		<div
			className={cn(
				"flex items-center gap-2 rounded-lg border bg-card p-2 pl-3",
				project.uses.length === 0 && "border-primary/25 bg-primary/5",
			)}
		>
			<PackageIcon className="size-3.5 shrink-0 text-muted-foreground" />
			<span className="flex min-w-0 flex-col">
				<span className="flex flex-wrap items-baseline gap-2">
					<span className="font-medium text-sm">{project.slug}</span>
					{project.version !== null && (
						<span className="text-muted-foreground text-xs tabular-nums">
							{project.version}
						</span>
					)}
					{project.changes !== undefined && (
						<Badge
							variant={
								project.changes.commits !== null && project.changes.commits > 0
									? "default"
									: "secondary"
							}
							title={
								project.changes.error ??
								`Since ${project.changes.tag} on ${project.changes.branch}`
							}
						>
							{project.changes.commits === null
								? "Release status unknown"
								: project.changes.commits === 0
									? "Up to date"
									: `${project.changes.commits} unshipped commit${project.changes.commits === 1 ? "" : "s"}`}
						</Badge>
					)}
				</span>
				<span className="truncate text-muted-foreground text-xs">
					{project.packages.length > 0
						? `Publishes ${project.packages.join(", ")}`
						: "Takes the releases it pins"}
				</span>
			</span>
			{shipped ? (
				<Button
					size="sm"
					variant="outline"
					className="ml-auto"
					title="Shows what the ship would publish, downstream too, before anything runs"
					onClick={onShip}
				>
					Ship
				</Button>
			) : (
				<span className="ml-auto shrink-0 text-muted-foreground text-xs">
					{project.private ? "" : "no ship command"}
				</span>
			)}
		</div>
	);
}
