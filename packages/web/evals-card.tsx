import { useAuiState } from "@assistant-ui/react";
import type { EvalPlan } from "@stringsync/splates-server/evals/browser";
import type { PermissionProposal } from "@stringsync/splates-server/plans";
import { RUN_DENIED } from "@stringsync/splates-server/plans/browser";
import { useReactive } from "@webappwiz/react";
import { BanIcon, FlaskConicalIcon, PlayIcon, SquareIcon } from "lucide-react";
import {
	createContext,
	type JSX,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { Button } from "#web/components/ui/button.tsx";
import { CardBox, useCardDictationTurn } from "./card-box";
import { useCardReply, useKept } from "./card-reply";
import { CardBody, CardShell } from "./card-shell";
import { EvalSummary } from "./eval-report";
import { EvalRun } from "./eval-run";
import { ORDER, spent } from "./eval-status";
import { Refusal, useRefusal } from "./refusal";

/** The conversation the card is in, which the server tells once its run is done; null outside one. */
export const EvalsConversation = createContext<string | null>(null);

/**
 * The card an agent asks to run evals with: the scenarios it picked, the saved
 * agents they run on (each can be left out for this run) and what the runner
 * would reserve. Only its Run button spends anything. Once it runs, the card
 * is the run's progress, cells landed of those planned, the tally and the
 * cost so far, linked to the report on the Evals page; a Stop button ends it.
 * Once done, it shows the report condensed, and the agent is told, with it.
 * Before it runs, Reject turns it down and tells the agent, and "Anything else"
 * carries a note to the agent with Reject or Run.
 */
export function EvalsCard({
	proposal,
}: {
	proposal: PermissionProposal;
}): JSX.Element {
	const conversation = useContext(EvalsConversation);
	const message = useAuiState((state) => state.message.id);
	const [run] = useState(() => EvalRun.of(proposal, { conversation, message }));
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
	const { reply, sent } = useCardReply();
	const { refusal, attempt } = useRefusal();
	const [rejected, setRejected] = useState(false);
	const kept = useKept(`run-evals:${run.key}`, sent);
	const [more, setMore] = useState(kept.read);
	const written = useRef(more);
	const panel = useRef<HTMLDivElement>(null);
	const turn = useCardDictationTurn(panel);
	const send = reply?.send ?? null;
	const turnedDown = rejected || (sent?.includes(RUN_DENIED) ?? false);
	const open = launch === null && !turnedDown;
	const note = (): string => written.current.trim();
	const reject = (): void => {
		if (send === null) {
			return;
		}
		setRejected(true);
		void attempt(
			send(
				note() === ""
					? RUN_DENIED
					: `${RUN_DENIED}\n\n> **Anything else?**\n\n${note()}`,
			).catch((error: unknown) => {
				setRejected(false);
				throw error;
			}),
			"Not rejected",
		);
	};
	const start = (): void => {
		void run.run();
		if (send !== null && note() !== "") {
			void attempt(send(note()), "Note not sent");
		}
	};
	const landed = grid === null ? 0 : grid.cells - (grid.tally.pending ?? 0);
	return (
		<CardShell
			label={`run evals ${run.ask.skill}`}
			Icon={FlaskConicalIcon}
			title={
				turnedDown
					? "Evals rejected"
					: launch === null
						? `Run ${run.ask.skill} evals`
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
			{launch === null && !turnedDown ? (
				<>
					<section
						aria-label="scenarios"
						className="mx-4 mb-3 flex flex-col gap-2 text-sm"
					>
						{state.groups.map((group) => (
							<div key={group.group}>
								{group.group !== "" && (
									<div className="font-medium">{group.group}</div>
								)}
								{group.abouts.map((each) => (
									<div
										key={each.about}
										className="ml-3 text-muted-foreground text-xs"
									>
										{each.about !== "" && `${each.about}: `}
										{each.scenarios.map((id) => (
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
								Not a scenario: {state.unknown.join(", ")}
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
			) : launch === null ? null : (
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
								{state.plan?.usd != null
									? ` of at most $${state.plan.usd.toFixed(2)}`
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
			{open && send !== null && (
				<div ref={panel} className="flex flex-col gap-3 border-t px-4 py-4">
					<p className="font-medium text-sm leading-snug">Anything else?</p>
					<CardBox
						aria-label="Anything else"
						value={more}
						placeholder="Your note (optional)"
						files={null}
						onValue={(text) => {
							written.current = text;
							setMore(text);
							kept.write(text);
						}}
					/>
				</div>
			)}
			{turnedDown && (sent ?? "").includes("> **Anything else?**") && (
				<CardBody
					text={`> **Anything else?**\n\n${(sent ?? "").split("> **Anything else?**\n\n").slice(1).join("")}`}
				/>
			)}
			{open && state.plan !== null && (
				<p className="mx-4 mb-3 text-muted-foreground text-xs">
					{planText(state.plan)}
				</p>
			)}
			<div className="flex items-center justify-end gap-2 border-border/60 border-t px-4 py-2.5 @max-md:px-3">
				{open && (
					<Button
						size="sm"
						variant="outline"
						className="gap-1.5"
						disabled={send === null}
						onClick={() => turn(reject)}
					>
						<BanIcon data-icon="inline-start" />
						Reject
					</Button>
				)}
				{open && (
					<Button
						size="sm"
						className="gap-1.5"
						disabled={
							!state.loaded ||
							state.unknown.length > 0 ||
							state.plan === null ||
							state.plan.refused
						}
						onClick={() => turn(start)}
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
			<Refusal refusal={state.refusal ?? refusal} className="mx-4 mb-3" />
		</CardShell>
	);
}

/** What the plan says of the run: its ceiling, its refusal, or that the project prints none. */
function planText(plan: EvalPlan): string {
	if (plan.refused) {
		return plan.output;
	}
	if (plan.usd === null) {
		return plan.output !== ""
			? plan.output
			: "This project prints no plan, so the run shows no cost ceiling.";
	}
	const runs =
		plan.cells === null
			? ""
			: ` across ${plan.cells} ${plan.cells === 1 ? "run" : "runs"}`;
	return `At most $${plan.usd.toFixed(2)}${runs}.`;
}
