import type { Composed, ComposedTarget } from "@splates/server/ship";
import type { JSX } from "react";

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
				<section
					key={wave.join(" ")}
					aria-label={`Group ${index + 1}`}
					className="flex flex-col gap-2"
				>
					{(count > 1 || wave.length > 1) && (
						<h3 className="font-semibold text-sm">
							{count > 1 ? (
								<>
									Group {index + 1}
									{wave.length > 1 && (
										<span className="font-normal text-muted-foreground text-xs">
											{" "}
											· {wave.length} at the same time
										</span>
									)}
								</>
							) : (
								`${wave.length} at the same time`
							)}
						</h3>
					)}
					{wave.map((name) => {
						const target = byName.get(name);
						return target === undefined ? null : (
							<TargetCard key={name} target={target} />
						);
					})}
				</section>
			))}
		</div>
	);
}

/** One target's card: its name, the version it resolved and its bump, and its error when composing failed. */
function TargetCard({ target }: { target: ComposedTarget }): JSX.Element {
	return (
		<article
			aria-label={target.name}
			className="flex flex-col gap-1 rounded-lg border border-border bg-card px-3.5 py-3"
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
		</article>
	);
}
