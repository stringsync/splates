import type { Composed, ComposedTarget } from "@splates/server/ship";
import type { JSX } from "react";
import { Card } from "./components/ui/card";
import { PageSection } from "./page-section";

/**
 * Shows `plan` as numbered groups run in order, each a card per target
 * shipping in it; the steps inside a target are left to the run page.
 */
export function ShipReview({ plan }: { plan: Composed }): JSX.Element {
	const byName = new Map(plan.targets.map((each) => [each.name, each]));
	const count = plan.waves.length;
	return (
		<div className="flex flex-col gap-3">
			{plan.waves.map((wave, index) => (
				<PageSection
					key={wave.join(" ")}
					label={`Group ${index + 1}`}
					as="h3"
					title={
						count > 1 || wave.length > 1
							? count > 1
								? `Group ${index + 1}`
								: `${wave.length} at the same time`
							: undefined
					}
					count={
						count > 1 && wave.length > 1
							? `· ${wave.length} at the same time`
							: undefined
					}
					className="gap-2"
				>
					{wave.map((name) => {
						const target = byName.get(name);
						return target === undefined ? null : (
							<TargetCard key={name} target={target} />
						);
					})}
				</PageSection>
			))}
		</div>
	);
}

/** One target's card: its name, the version it resolved and its bump, and its error when composing failed. */
function TargetCard({ target }: { target: ComposedTarget }): JSX.Element {
	return (
		<Card
			render={<article />}
			aria-label={target.name}
			className="flex flex-col gap-1 px-3.5 py-3"
		>
			<span className="font-semibold text-sm">
				{target.name}
				{(target.version ?? target.bump) !== undefined && (
					<span className="font-normal text-muted-foreground text-xs">
						{" "}
						·{" "}
						{target.version === undefined
							? target.bump
							: `${target.version}${target.bump === undefined ? "" : ` (${target.bump})`}`}
					</span>
				)}
			</span>
			{target.error !== undefined && (
				<p className="text-destructive text-xs">{target.error}</p>
			)}
		</Card>
	);
}
