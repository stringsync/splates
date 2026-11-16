import type { Composed, ComposedTarget } from "@splates/server/ship";
import type { JSX } from "react";
import { StepTimeline, StepTimelineItem } from "./step-timeline";

/**
 * The composed plan as numbered steps run in order, each a card per target
 * shipping in it, and each card every `does` line its target will run.
 */
export function ShipReview({ plan }: { plan: Composed }): JSX.Element {
	const byName = new Map(plan.targets.map((each) => [each.name, each]));
	const count = plan.waves.length;
	return (
		<div className="flex flex-col gap-3">
			{count > 1 && (
				<p className="text-muted-foreground text-sm">
					{count} steps, in order. Each starts once the one before is done.
				</p>
			)}
			{plan.waves.map((wave, index) => (
				<section
					key={wave.join(" ")}
					aria-label={`Step ${index + 1}`}
					className="flex flex-col gap-2"
				>
					{(count > 1 || wave.length > 1) && (
						<h3 className="font-semibold text-sm">
							{count > 1 ? (
								<>
									Step {index + 1}
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

/** One target's card: its name, then each step's `does` line in order. */
function TargetCard({ target }: { target: ComposedTarget }): JSX.Element {
	const does = new Map(target.steps.map((step) => [step.id, step.does]));
	const ids = target.waves.flat();
	return (
		<article
			aria-label={target.name}
			className="flex flex-col gap-1 rounded-lg border border-border bg-card px-3.5 py-3"
		>
			<span className="font-semibold text-sm">
				{target.name}
				{target.bump !== undefined && (
					<span className="font-normal text-muted-foreground text-xs">
						{" "}
						· {target.bump}
					</span>
				)}
			</span>
			{target.error !== undefined && (
				<p className="text-destructive text-xs">{target.error}</p>
			)}
			<StepTimeline label="Steps">
				{ids.map((id, index) => (
					<StepTimelineItem
						key={id}
						label={does.get(id) ?? id}
						standing="next"
						wrap
						last={index === ids.length - 1}
						line={
							<span className="min-w-0 flex-1 text-left">{does.get(id)}</span>
						}
					/>
				))}
			</StepTimeline>
		</article>
	);
}
