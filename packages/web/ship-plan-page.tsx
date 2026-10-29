import type { ShipBump, ShipGraph } from "@stringsync/splates-server/ship";
import {
	CHANGED,
	changedProjects,
} from "@stringsync/splates-server/ship/browser";
import { type JSX, useEffect, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { shipGraph } from "./api";
import { startShip } from "./api/ship";
import { BackButton } from "./back-button";
import { TopBar } from "./top-bar";
import { useLiveShips } from "./use-live-ships";

/** Plan a release: choose projects, version bumps and agent instructions, then Start. */
export function ShipPlanPage(): JSX.Element {
	const [graph, setGraph] = useState<ShipGraph | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [excluded, setExcluded] = useState<string[]>([]);
	const [choices, setChoices] = useState<
		Record<
			string,
			{ bump: ShipBump; adopt: "mechanical" | "agent"; instructions: string }
		>
	>({});
	const [pending, setPending] = useState(false);
	const live = useLiveShips();
	useEffect(() => {
		shipGraph().then(setGraph, (error: unknown) => setError(String(error)));
	}, []);
	const selected = new URLSearchParams(location.search).get("ship") ?? CHANGED;
	const roots =
		graph === null
			? []
			: selected === CHANGED
				? changedProjects(graph).map((project) => project.slug)
				: [selected];
	const included = new Set<string>();
	const visit = (slug: string) => {
		if (included.has(slug) || excluded.includes(slug)) {
			return;
		}
		included.add(slug);
		for (const project of graph?.projects ?? []) {
			if (project.uses.some((use) => use.project === slug)) {
				visit(project.slug);
			}
		}
	};
	for (const root of roots) {
		visit(root);
	}
	const ordered: NonNullable<typeof graph>["projects"] = [];
	const visited = new Set<string>();
	const order = (slug: string) => {
		if (visited.has(slug)) {
			return;
		}
		visited.add(slug);
		const project = graph?.projects.find((project) => project.slug === slug);
		if (!project) {
			return;
		}
		for (const use of project.uses) {
			if (included.has(use.project)) {
				order(use.project);
			}
		}
		if (included.has(slug) && project.ship !== null && !project.private) {
			ordered.push(project);
		}
	};
	for (const slug of included) {
		order(slug);
	}
	const choice = (slug: string) =>
		choices[slug] ?? {
			bump: "patch" as const,
			adopt: "mechanical" as const,
			instructions: "",
		};
	const update = (slug: string, patch: Partial<ReturnType<typeof choice>>) =>
		setChoices((current) => ({
			...current,
			[slug]: { ...choice(slug), ...patch },
		}));
	const busy =
		live === null ||
		live.cascade?.status === "running" ||
		live.cascade?.status === "stopped";
	return (
		<section aria-label="ship plan" className="flex min-w-0 flex-col gap-6">
			<TopBar
				leading={
					<BackButton
						parent="Ship"
						onBack={() => {
							location.hash = "ships";
						}}
					/>
				}
				title="Plan a ship"
			/>
			{busy && (
				<p role="status">
					{live === null ? (
						"Checking for a ship under way…"
					) : (
						<>
							A ship is under way.{" "}
							<a href="#ships" className="underline">
								View its steps
							</a>
						</>
					)}
				</p>
			)}
			{error && (
				<p role="alert" className="text-destructive">
					{error}
				</p>
			)}
			{graph === null ? (
				<p>Reading the projects…</p>
			) : (
				<>
					<ol aria-label="Release order" className="flex flex-col gap-4">
						{ordered.map((project) => {
							const value = choice(project.slug);
							return (
								<li
									key={project.slug}
									className="flex min-w-0 flex-col gap-4 rounded-lg border bg-card p-4"
								>
									<div className="flex flex-wrap items-center justify-between gap-3">
										<div>
											<h2 className="font-medium">{project.slug}</h2>
											<p className="text-muted-foreground text-sm">
												{project.version ?? "Unknown version"} ·{" "}
												{project.changes?.commits == null
													? "Release status unknown"
													: `${project.changes.commits} unshipped`}
											</p>
										</div>
										<Button
											variant="outline"
											className="min-h-11"
											disabled={pending}
											onClick={() => setExcluded([...excluded, project.slug])}
										>
											Leave out
										</Button>
									</div>
									<label className="flex flex-col gap-2 text-sm">
										Version bump
										<select
											aria-label={`${project.slug} version bump`}
											className="min-h-11 rounded-md border bg-background px-3"
											disabled={pending}
											value={value.bump}
											onChange={(event) =>
												update(project.slug, {
													bump: event.target.value as ShipBump,
												})
											}
										>
											<option>patch</option>
											<option>minor</option>
											<option>major</option>
										</select>
									</label>
									<label className="flex min-h-11 items-center gap-3 text-sm">
										<input
											type="checkbox"
											checked={value.adopt === "agent"}
											disabled={pending}
											onChange={(event) =>
												update(project.slug, {
													adopt: event.target.checked ? "agent" : "mechanical",
												})
											}
										/>
										Agent task for {project.slug}
									</label>
									{value.adopt === "agent" && (
										<label className="flex flex-col gap-2 text-sm">
											Instructions for {project.slug}
											<textarea
												className="min-h-28 rounded-md border bg-background p-3"
												disabled={pending}
												value={value.instructions}
												onChange={(event) =>
													update(project.slug, {
														instructions: event.target.value,
													})
												}
											/>
										</label>
									)}
								</li>
							);
						})}
					</ol>
					{excluded.map((slug) => (
						<Button
							key={slug}
							variant="outline"
							disabled={pending}
							onClick={() =>
								setExcluded(excluded.filter((each) => each !== slug))
							}
						>
							Ship {slug}
						</Button>
					))}
					{ordered.length === 0 && <p>No projects selected to ship.</p>}
					<Button
						className="min-h-11 w-full"
						disabled={busy || pending || ordered.length === 0}
						onClick={() => {
							setPending(true);
							setError(null);
							startShip({
								projects: ordered.map((project) => ({
									slug: project.slug,
									...choice(project.slug),
								})),
							}).then(
								() => {
									location.hash = "ships";
								},
								(error: unknown) => {
									setPending(false);
									setError(String(error));
								},
							);
						}}
					>
						{pending ? "Starting…" : "Start"}
					</Button>
				</>
			)}
		</section>
	);
}
