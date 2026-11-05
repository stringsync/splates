import type { EvalPlan } from "@splates/server/evals";
export function EvalRunCue({
	open,
	state,
}: {
	open: boolean;
	state: { unknown: string[]; unknownAgents: string[]; plan: EvalPlan | null };
}) {
	const { plan } = state;
	const unknown = state.unknown.length > 0;
	const unknownAgents = state.unknownAgents.length > 0;
	const unavailable = unknown
		? "Run unavailable: choose valid scenarios."
		: unknownAgents
			? "Run unavailable: choose saved agents."
			: plan === null
				? "Run unavailable: waiting for a run plan. Select at least one agent."
				: plan.refused
					? "Run unavailable: the run plan was refused."
					: null;
	return (
		<>
			{open && unavailable !== null && (
				<p role="status" className="mx-4 mb-3 text-muted-foreground text-xs">
					{unavailable}
				</p>
			)}
		</>
	);
}
