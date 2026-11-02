import type { ShipProject } from "@splates/server/ship";
import type { JSX } from "react";

/**
 * What Start will do, release by release in order: the version each project
 * gets and the pins it takes first, before anything is sent.
 */
export function ShipPreview({
	ordered,
	shipsAll,
	versionAfter,
}: {
	/** The projects that ship, in release order. */
	ordered: ShipProject[];
	/** The slugs that ship, so a pin on one of them is named. */
	shipsAll: Set<string>;
	/** The version a shipping project gets, or null when it is not `x.y.z`. */
	versionAfter: (slug: string) => string | null;
}): JSX.Element {
	return (
		<section
			aria-label="What Start will do"
			className="flex flex-col gap-2 rounded-lg border bg-card p-3 text-sm"
		>
			<h2 className="font-medium">What Start will do</h2>
			<ol className="flex list-decimal flex-col gap-1 pl-5">
				{ordered.map((each) => {
					const pins = each.uses
						.filter((use) => shipsAll.has(use.project))
						.map((use) => `${use.project} ${versionAfter(use.project)}`);
					return (
						<li key={each.slug}>
							<b>{each.slug}</b> {each.version} →{" "}
							<b>{versionAfter(each.slug)}</b>
							<span className="text-muted-foreground">
								{pins.length > 0
									? `: pin ${pins.join(", ")}, then publish`
									: ": publish, tag and write notes"}
							</span>
						</li>
					);
				})}
			</ol>
			<p className="text-muted-foreground text-xs">
				You can stop between projects. Nothing is sent until you press Ship.
			</p>
		</section>
	);
}
