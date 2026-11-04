import type { ShipProject } from "@splates/server/ship";
import type { JSX } from "react";

/**
 * The review page of a ship: each release in order, with the version it gets,
 * the pins it takes first and how they are adopted, before anything is sent.
 */
export function ShipPreview({
	ordered,
	shipsAll,
	versionAfter,
	bumpOf,
	adoptOf,
}: {
	/** The projects that ship, in release order. */
	ordered: ShipProject[];
	/** The slugs that ship, so a pin on one of them is named. */
	shipsAll: Set<string>;
	/** The version a shipping project gets, or null when it is not `x.y.z`. */
	versionAfter: (slug: string) => string | null;
	bumpOf: (slug: string) => string;
	adoptOf: (slug: string) => "mechanical" | "agent";
}): JSX.Element {
	return (
		<section aria-label="What Start will do" className="flex flex-col gap-3">
			<div>
				<h2 className="font-medium text-lg">Review this ship</h2>
				<p className="text-muted-foreground text-xs">
					{ordered.length} {ordered.length === 1 ? "project" : "projects"},
					released in this order. Nothing is sent until you accept.
				</p>
			</div>
			<ol className="flex flex-col rounded-lg border bg-card px-4">
				{ordered.map((each, index) => {
					const pins = each.uses
						.filter((use) => shipsAll.has(use.project))
						.map((use) => `${use.project} ${versionAfter(use.project)}`);
					const commits = each.changes?.commits ?? 0;
					return (
						<li
							key={each.slug}
							aria-label={each.slug}
							className="flex gap-3 border-b py-3.5 last:border-b-0"
						>
							<span
								aria-hidden
								className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs"
							>
								{index + 1}
							</span>
							<div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
								<span className="flex flex-wrap items-baseline gap-2">
									<b>{each.slug}</b>
									<span className="text-muted-foreground tabular-nums">
										{each.version} → <b>{versionAfter(each.slug)}</b>
									</span>
									<span className="rounded-full bg-muted px-2 text-muted-foreground text-xs">
										{bumpOf(each.slug)}
									</span>
									{each.deploy === true && (
										<span className="rounded-full bg-muted px-2 text-muted-foreground text-xs">
											deploy
										</span>
									)}
								</span>
								{commits > 0 && (
									<span className="text-warning text-xs">
										{commits} {commits === 1 ? "commit" : "commits"} since{" "}
										{each.changes?.tag}
									</span>
								)}
								<span className="text-muted-foreground text-xs">
									{pins.length > 0
										? `First: pin ${pins.join(", ")}`
										: "No pins to move"}
									{" · "}
									{adoptOf(each.slug) === "agent"
										? "Agent task"
										: "Mechanical adoption"}
									{" · then publish, tag and write notes"}
								</span>
							</div>
						</li>
					);
				})}
			</ol>
			<p className="text-muted-foreground text-xs">
				You can stop between projects once the ship starts.
			</p>
		</section>
	);
}
