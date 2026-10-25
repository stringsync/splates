import type { PermissionProposal } from "@stringsync/splates-server/plans";
import { useReactive } from "@webappwiz/react";
import { FlaskConicalIcon, PlayIcon, SquareIcon } from "lucide-react";
import {
	createContext,
	type JSX,
	useContext,
	useEffect,
	useState,
} from "react";
import { Button } from "#web/components/ui/button.tsx";
import { CardBody, CardShell } from "./card-shell";
import { EvalSummary } from "./eval-report";
import { EvalRun } from "./eval-run";
import { ORDER, spent } from "./eval-status";
import { Refusal } from "./refusal";

/** The conversation the card is in, which the server tells once its run is done; null outside one. */
export const EvalsConversation = createContext<string | null>(null);

/**
 * The card an agent asks to run evals with: the probes it picked, the saved
 * agents they run on (each can be left out for this run) and what the runner
 * would reserve. Only its Run button spends anything. Once it runs, the card
 * is the run's progress, cells landed of those planned, the tally and the
 * cost so far, linked to the report on the Evals page; a Stop button ends it.
 * Once done, it shows the report condensed, and the agent is told, with it.
 */
export function EvalsCard({
	proposal,
}: {
	proposal: PermissionProposal;
}): JSX.Element {
	const conversation = useContext(EvalsConversation);
	const [run] = useState(() => EvalRun.of(proposal, { conversation }));
	useEffect(() => {
		void run.load();
		return () => run.dispose();
	}, [run]);
	const state = useReactive(
		run,
		(each) => ({
			agents: each.agents.map((agent) => ({ ...agent })),
			groups: each.groups,
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
	const landed = grid === null ? 0 : grid.cells - (grid.tally.pending ?? 0);
	return (
		<CardShell
			label={`run evals ${run.ask.skill}`}
			Icon={FlaskConicalIcon}
			title={
				launch === null
					? `Run evals on the ${run.ask.skill} skill`
					: state.running
						? "Running evals"
						: launch.status === "refused"
							? "Evals refused"
							: launch.status === "stopped"
								? "Evals stopped"
								: "Evals done"
			}
			tone="info"
		>
			{proposal.body !== "" && <CardBody text={proposal.body} />}
			{launch === null ? (
				<>
					<section
						aria-label="probes"
						className="mx-4 mb-3 flex flex-col gap-2 text-sm"
					>
						{state.groups.map((group) => (
							<div key={group.aspect}>
								<div className="font-medium">{group.aspect}</div>
								{group.requirements.map((each) => (
									<div
										key={each.requirement}
										className="ml-3 text-muted-foreground text-xs"
									>
										{each.requirement}:{" "}
										{each.probes.map((id) => (
											<code key={id} className="mr-1.5">
												{id}
											</code>
										))}
									</div>
								))}
							</div>
						))}
						{state.unknown.length > 0 && (
							<p className="text-destructive text-xs">
								Not a probe: {state.unknown.join(", ")}
							</p>
						)}
					</section>
					<fieldset
						aria-label="agents"
						className="mx-4 mb-3 flex flex-col gap-1 text-sm"
					>
						{state.agents.length === 0 && state.loaded && (
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
				</>
			) : (
				<div className="mx-4 mb-3 flex flex-col gap-1 text-sm">
					{grid !== null && (
						<>
							<div>
								{landed} of {grid.cells} cells landed
								{ORDER.filter((each) => each !== "pending" && grid.tally[each])
									.map((each) => ` · ${grid.tally[each]} ${each}`)
									.join("")}
							</div>
							<div className="text-muted-foreground text-xs">
								{spent(grid)}
								{state.plan?.tokens != null && state.plan.usd != null
									? ` of ${state.plan.tokens.toLocaleString()} tokens · $${state.plan.usd.toFixed(2)} reserved`
									: ""}
							</div>
							{!state.running && <EvalSummary grid={grid} />}
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
				</div>
			)}
			{launch === null && state.plan !== null && (
				<p className="mx-4 mb-3 text-muted-foreground text-xs">
					{state.plan.tokens === null
						? state.plan.output
						: `Reserves up to ${state.plan.tokens.toLocaleString()} tokens · $${(state.plan.usd ?? 0).toFixed(2)} across ${state.plan.cells} ${state.plan.cells === 1 ? "run" : "runs"}.`}
				</p>
			)}
			<div className="flex items-center justify-end gap-2 border-border/60 border-t px-4 py-2.5 @max-md:px-3">
				{launch === null && (
					<Button
						size="sm"
						className="gap-1.5"
						disabled={
							!state.loaded ||
							state.unknown.length > 0 ||
							state.plan === null ||
							state.plan.tokens === null
						}
						onClick={() => void run.run()}
					>
						<PlayIcon data-icon="inline-start" />
						Run
					</Button>
				)}
				{state.running && (
					<Button
						size="sm"
						variant="outline"
						className="gap-1.5"
						onClick={() => void run.stop()}
					>
						<SquareIcon data-icon="inline-start" />
						Stop
					</Button>
				)}
			</div>
			<Refusal refusal={state.refusal} className="mx-4 mb-3" />
		</CardShell>
	);
}
