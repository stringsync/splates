import type { JSX } from "react";

const STEPS = [
	["Choose", "Tick the projects to release."],
	[
		"Review",
		"A project that uses another waits for it, then takes its new version.",
	],
	["Ship", "Each is published, tagged and verified, one after another."],
] as const;

/** What shipping is, in three steps, for a plan with nothing chosen yet. */
export function ShipIntro(): JSX.Element {
	return (
		<section
			aria-label="About shipping"
			className="flex flex-col gap-3 rounded-lg border bg-card p-4"
		>
			<div className="flex flex-col gap-1">
				<h2 className="font-medium text-sm">Release projects to the world</h2>
				<p className="text-muted-foreground text-sm">
					Pick what to publish. Projects that depend on a pick come along, so
					nothing is left pinned to an old version.
				</p>
			</div>
			<ol className="grid grid-cols-1 gap-3 sm:grid-cols-3">
				{STEPS.map(([title, text], index) => (
					<li key={title} className="flex items-start gap-2 sm:flex-col">
						<span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 font-medium text-primary text-xs">
							{index + 1}
						</span>
						<span className="flex flex-col text-xs">
							<b className="text-sm">{title}</b>
							<span className="text-muted-foreground">{text}</span>
						</span>
					</li>
				))}
			</ol>
		</section>
	);
}
