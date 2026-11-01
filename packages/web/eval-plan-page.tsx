import { useReactive } from "core/react";
import { PlayIcon, SquareIcon } from "lucide-react";
import { type JSX, useEffect, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { ReadingNow } from "./countdown";
import { EvalRun } from "./eval-run";
import { ORDER, planText, spent } from "./eval-status";
import { Refusal } from "./refusal";

/**
 * The plan of a run of one or more scenarios: the agents it would use (each can be
 * left out), the most it can cost, and a Run button, the person's alone to
 * press. Once it runs the page follows it and links to its report.
 */
export function EvalPlanPage({
	scenarios,
	skill,
}: {
	scenarios: string[];
	/** The skill or suite the scenario belongs to, which labels the run. */
	skill: string;
}): JSX.Element {
	const [run] = useState(
		() =>
			new EvalRun(
				{ skill, scenarios, baseline: null },
				`page:${skill}:${scenarios.join(",")}`,
			),
	);
	useEffect(() => {
		void run.load();
		return () => run.dispose();
	}, [run]);
	const state = useReactive(
		run,
		(each) => ({
			agents: each.agents.map((agent) => ({ ...agent })),
			unknown: each.unknown,
			plan: each.plan,
			launch: each.launch,
			grid: each.grid,
			refusal: each.refusal,
			loaded: each.loaded,
			running: each.running,
		}),
		["changed"],
	);
	const { launch, grid } = state;
	if (!state.loaded) {
		return <ReadingNow label="Planning the run…" />;
	}
	return (
		<section aria-label="eval plan" className="flex min-w-0 flex-col gap-4">
			<ul className="flex flex-col gap-0.5">
				{scenarios.map((scenario) => (
					<li key={scenario}>
						<code className="text-sm">{scenario}</code>
					</li>
				))}
			</ul>
			{launch === null ? (
				<>
					<fieldset aria-label="agents" className="flex flex-col gap-1 text-sm">
						{state.agents.length === 0 && (
							<p className="text-muted-foreground text-xs">
								No saved agents: add some on the Evals page.
							</p>
						)}
						{state.agents.map((each, index) => (
							<label
								key={`${each.pick.agent}/${each.pick.model}/${each.pick.effort}`}
								className="flex items-center gap-2"
							>
								<input
									type="checkbox"
									checked={each.on}
									onChange={() => void run.toggle(index)}
								/>
								{[each.pick.agent, each.pick.model, each.pick.effort]
									.filter((part) => part !== undefined)
									.join(" ")}
							</label>
						))}
					</fieldset>
					{state.unknown.length > 0 && (
						<p className="text-destructive text-xs">
							Not a scenario: {state.unknown.join(", ")}
						</p>
					)}
					{state.plan !== null && (
						<p className="text-muted-foreground text-xs">
							{planText(state.plan)}
						</p>
					)}
					<div className="flex justify-end">
						<Button
							size="sm"
							className="gap-1.5"
							disabled={
								state.unknown.length > 0 ||
								state.plan === null ||
								state.plan.refused
							}
							onClick={() => void run.run()}
						>
							<PlayIcon data-icon="inline-start" />
							Run
						</Button>
					</div>
				</>
			) : (
				<div className="flex flex-col gap-1 text-sm">
					<div>
						{state.running
							? "Running"
							: launch.status === "refused"
								? "Refused"
								: launch.status === "stopped"
									? "Stopped"
									: "Done"}
						{grid !== null &&
							` · ${grid.cells - (grid.tally.pending ?? 0)} of ${grid.cells} cells landed${ORDER.filter(
								(each) => each !== "pending" && grid.tally[each],
							)
								.map((each) => ` · ${grid.tally[each]} ${each}`)
								.join("")}`}
					</div>
					{grid !== null && (
						<>
							<div className="text-muted-foreground text-xs">
								{spent(grid)}
								{state.plan?.usd != null
									? ` of at most $${state.plan.usd.toFixed(2)}`
									: ""}
							</div>
							<a
								href={`#evals/${encodeURIComponent(grid.id)}`}
								className="text-info text-xs underline"
							>
								Open the report
							</a>
						</>
					)}
					{grid === null && launch.output !== "" && (
						<pre className="whitespace-pre-wrap text-muted-foreground text-xs">
							{launch.output}
						</pre>
					)}
					{state.running && (
						<div className="flex justify-end">
							<Button
								size="sm"
								variant="outline"
								className="gap-1.5"
								onClick={() => void run.stop()}
							>
								<SquareIcon data-icon="inline-start" />
								Stop
							</Button>
						</div>
					)}
				</div>
			)}
			<Refusal refusal={state.refusal} />
		</section>
	);
}
