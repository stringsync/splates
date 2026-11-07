import { useAuiState } from "@assistant-ui/react";
import type { PermissionProposal } from "@splates/server/plans";
import {
	EVALS_BUDGET_USED_UP,
	RUN_DENIED,
} from "@splates/server/plans/browser";
import { useReactive } from "core/react";
import {
	BanIcon,
	FlaskConicalIcon,
	PlayIcon,
	SettingsIcon,
	SquareIcon,
} from "lucide-react";
import {
	createContext,
	type JSX,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { Button } from "#web/components/ui/button.tsx";
import { Checkbox } from "#web/components/ui/checkbox.tsx";
import {
	Dialog,
	DialogContent,
	DialogTitle,
	DialogTrigger,
} from "#web/components/ui/dialog.tsx";
import { Skeleton } from "#web/components/ui/skeleton.tsx";
import { CardBox, useCardDictationTurn } from "./card-box";
import { useCardReply, useKept } from "./card-reply";
import { CardSection } from "./card-section";
import { CardBody, CardShell } from "./card-shell";
import { useEnterDoes } from "./enter-while-taking";
import { EvalAgentsEditor } from "./eval-agents";
import { EvalAgentsView } from "./eval-agents-view";
import { EvalCardScenarios } from "./eval-card-scenarios";
import { useLoopLimits } from "./eval-loop-limits";
import { EvalSummary } from "./eval-report";
import { EvalRun } from "./eval-run";
import { EvalRunCue } from "./eval-run-cue";
import { SettingField } from "./eval-setting-field";
import {
	budgetText,
	ORDER,
	planText,
	roundsText,
	spent,
	stoppedText,
} from "./eval-status";
import { PendingSpinner, useShowPending } from "./pending";
import { Refusal, useRefusal } from "./refusal";

/** The conversation the card is in, which the server tells once its run is done; null outside one. */
export const EvalsConversation = createContext<string | null>(null);

/** Plans evals, explains availability, and shows progress after a manual or budgeted start. */
export function EvalsCard({
	proposal,
}: {
	proposal: PermissionProposal;
}): JSX.Element {
	const conversation = useContext(EvalsConversation);
	const [editor] = useState(() => new EvalAgentsEditor());
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
			scenarios: each.scenarios,
			groups: each.groups,
			unknown: each.unknown,
			unknownAgents: each.unknownAgents,
			plan: each.plan,
			launch: each.launch,
			grid: each.grid,
			budget: each.budget,
			limits: each.limits,
			refusal: each.refusal,
			loaded: each.loaded,
			running: each.running,
		}),
		["changed"],
	);
	const { launch, grid } = state;
	const { reply, sent } = useCardReply();
	const { refusal, attempt } = useRefusal();
	const [rejecting, setRejecting] = useState(false);
	const [loopStopped, setLoopStopped] = useState(false);
	const kept = useKept(`run-evals:${run.key}`, sent);
	const [more, setMore] = useState(kept.read);
	const written = useRef(more);
	const panel = useRef<HTMLDivElement>(null);
	const turn = useCardDictationTurn(panel);
	const send = reply?.send ?? null;
	const turnedDown = sent?.includes(RUN_DENIED) ?? false;
	const usedUp =
		launch === null && state.budget !== null ? stoppedText(state.budget) : null;
	const open = launch === null && !turnedDown && usedUp === null;
	const showRejecting = useShowPending(rejecting);
	const enterDoes = useEnterDoes(
		panel,
		!open ||
			send === null ||
			!state.loaded ||
			state.unknown.length > 0 ||
			state.unknownAgents.length > 0 ||
			state.plan === null ||
			state.plan.refused
			? null
			: () => turn(start),
	);
	useLoopLimits(run, {
		ready:
			open &&
			send !== null &&
			state.loaded &&
			state.unknown.length === 0 &&
			state.unknownAgents.length === 0 &&
			state.plan !== null &&
			!state.plan.refused,
	});
	// A card the budget cannot cover never runs: tell the agent once, so its
	// turn is not left waiting on a tap that cannot start anything.
	const told = useRef(false);
	useEffect(() => {
		if (usedUp === null || send === null || told.current || !state.budget) {
			return;
		}
		told.current = true;
		void attempt(
			send(
				`${EVALS_BUDGET_USED_UP}\n\nThe run your run evals card asked for was refused: ${usedUp.replace(/^Stopped: /, "")} ${budgetText(state.budget)} · ${roundsText(state.budget)}. Do not ask for another run or run the eval command yourself; only the user tops the budget up. Stop and report.`,
			),
			"Agent not told",
		);
	}, [usedUp, send, state.budget, attempt]);
	if (!state.loaded) {
		return (
			<CardShell
				label={`run evals ${run.ask.skill}`}
				Icon={FlaskConicalIcon}
				title={`Run ${run.ask.skill} evals`}
				tone="eval"
			>
				<div
					role="status"
					aria-busy="true"
					aria-label="Loading evals"
					className="flex flex-col gap-3 px-4 py-3"
				>
					<Skeleton className="h-3 w-[30%] animate-pulse" />
					<div className="ml-3 flex flex-col gap-1.5">
						<Skeleton className="h-2.5 w-[80%] animate-pulse" />
						<Skeleton className="h-2.5 w-[45%] animate-pulse" />
					</div>
					<div className="flex items-center gap-2">
						<Skeleton className="size-3.5 animate-pulse" />
						<Skeleton className="h-3 w-[35%] animate-pulse" />
					</div>
					<div className="flex items-center gap-2">
						<Skeleton className="size-3.5 animate-pulse" />
						<Skeleton className="h-3 w-[30%] animate-pulse" />
					</div>
					<Skeleton className="h-16 animate-pulse rounded-lg" />
				</div>
				<div className="flex items-center justify-end gap-2 border-border/60 border-t px-4 py-2.5">
					<Skeleton className="h-8 w-20 animate-pulse rounded-lg" />
					<Skeleton className="h-8 w-16 animate-pulse rounded-lg" />
				</div>
			</CardShell>
		);
	}
	const note = (): string => written.current.trim();
	const stopLoop = (): void => {
		if (send === null) {
			return;
		}
		setLoopStopped(true);
		void attempt(
			send(
				"Stop the eval loop here: start no further rounds and run no more evals. Report where it stands.",
			),
			"Agent not told",
		);
	};
	const reject = (): void => {
		if (send === null) {
			return;
		}
		setRejecting(true);
		void attempt(
			send(
				note() === ""
					? RUN_DENIED
					: `${RUN_DENIED}\n\n> **Anything else?**\n\n${note()}`,
			).catch((error: unknown) => {
				setRejecting(false);
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
	return (
		<CardShell
			label={`run evals ${run.ask.skill}`}
			Icon={FlaskConicalIcon}
			title={
				turnedDown
					? "Evals rejected"
					: usedUp !== null
						? "Evals refused"
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
			tone="eval"
		>
			{proposal.body !== "" && <CardBody text={proposal.body} />}
			{launch === null && !turnedDown ? (
				<>
					<CardSection
						label="scenarios"
						title={`${state.scenarios.length} scenarios`}
						className="mx-4 mb-3 text-sm"
					>
						<div className="flex flex-col gap-3">
							<EvalCardScenarios scenarios={state.scenarios} />
							{state.unknown.length > 0 && (
								<p className="text-destructive text-xs">
									Not a scenario: {state.unknown.join(", ")}
								</p>
							)}
						</div>
					</CardSection>
					<CardSection label="agents" title="Run on" className="mx-4 mb-3">
						<fieldset className="flex flex-col gap-2 text-sm">
							<legend className="sr-only">Run on</legend>
							{state.unknownAgents.length > 0 && (
								<p className="text-destructive text-xs">
									Not a saved agent: {state.unknownAgents.join(", ")}
								</p>
							)}
							<ul className="flex flex-col gap-1.5">
								{state.agents.map((each, index) => (
									<li
										key={`${each.pick.agent}/${each.pick.model}/${each.pick.effort}`}
									>
										<label
											htmlFor={`eval-agent-${index}`}
											className={`flex cursor-pointer items-center gap-2 text-sm ${each.on ? "text-foreground" : "text-muted-foreground"}`}
										>
											<Checkbox
												id={`eval-agent-${index}`}
												checked={each.on}
												onCheckedChange={() => void run.toggle(index)}
											/>
											{[each.pick.agent, each.pick.model, each.pick.effort]
												.filter((part) => part !== undefined)
												.join(" ")}
										</label>
									</li>
								))}
							</ul>
							<div>
								<Dialog onOpenChange={(now) => now || void run.load()}>
									<DialogTrigger
										render={
											<Button size="xs" variant="ghost" className="gap-1" />
										}
									>
										<SettingsIcon data-icon="inline-start" />
										{state.agents.length === 0 ? "Add agents" : "Edit agents"}
									</DialogTrigger>
									<DialogContent className="sm:max-w-2xl">
										<DialogTitle>Saved eval agents</DialogTitle>
										<EvalAgentsView editor={editor} />
									</DialogContent>
								</Dialog>
							</div>
							{state.agents.length === 0 && state.loaded && (
								<p className="text-muted-foreground text-xs">
									No saved agents yet.
								</p>
							)}
						</fieldset>
					</CardSection>
					<fieldset
						aria-label="run settings"
						className="mx-4 mb-3 grid grid-cols-3 gap-2 text-xs"
					>
						<SettingField
							label="Repetitions"
							aria-label="Run repetitions"
							min={1}
							defaultValue={run.ask.reps}
							placeholder="Default"
							onChange={(event) => void run.repeat(Number(event.target.value))}
						/>
						{conversation !== null && !state.budget?.roundsUsed && (
							<>
								<SettingField
									label="Budget ($)"
									aria-label="Budget in dollars"
									min={0.01}
									step="any"
									value={state.limits.usd}
									onChange={(event) =>
										run.setLimits({ usd: Number(event.target.value) })
									}
								/>
								<SettingField
									label="Max rounds"
									aria-label="Max rounds"
									min={1}
									step={1}
									value={state.limits.rounds}
									onChange={(event) =>
										run.setLimits({ rounds: Number(event.target.value) })
									}
								/>
							</>
						)}
					</fieldset>
				</>
			) : launch === null ? null : (
				<div className="mx-4 mb-3 flex flex-col gap-1 text-sm">
					{grid !== null && (
						<>
							<div>
								{grid.cells - (grid.tally.pending ?? 0)} of {grid.cells} cells
								landed
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
						onKeyDown={enterDoes}
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
			{state.budget !== null && (
				<div
					data-testid="budget"
					className="mx-4 mb-3 flex flex-col gap-0.5 text-muted-foreground text-xs"
				>
					<div>
						{budgetText(state.budget)} · {roundsText(state.budget)}
					</div>
					{stoppedText(state.budget) !== null && (
						<div className="text-destructive">
							{stoppedText(state.budget)}
							{launch === null &&
								" This run was refused and the agent has been told; raise the budget to go on."}
						</div>
					)}
				</div>
			)}
			<EvalRunCue open={open} state={state} />
			{open && state.plan !== null && (
				<p className="mx-4 mb-3 text-muted-foreground text-xs">
					{planText(state.plan)}
				</p>
			)}
			<div className="flex items-center justify-end gap-2 border-border/60 border-t px-4 py-2.5">
				{open && (
					<Button
						size="sm"
						variant="outline"
						className="gap-1.5 in-data-sheet:h-11 in-data-sheet:text-base"
						disabled={send === null || rejecting}
						onClick={() => turn(reject)}
					>
						{rejecting && showRejecting ? (
							<PendingSpinner shown />
						) : (
							<BanIcon data-icon="inline-start" />
						)}
						Reject
					</Button>
				)}
				{open && (
					<Button
						size="sm"
						className="gap-1.5 in-data-sheet:h-11 in-data-sheet:text-base in-data-sheet:flex-1"
						disabled={
							!state.loaded ||
							state.unknown.length > 0 ||
							state.unknownAgents.length > 0 ||
							state.plan === null ||
							state.plan.refused
						}
						onClick={() => turn(start)}
					>
						<PlayIcon data-icon="inline-start" />
						Run
					</Button>
				)}
				{launch !== null && !state.running && state.budget !== null && (
					<Button
						size="sm"
						variant="outline"
						className="gap-1.5 in-data-sheet:h-11 in-data-sheet:flex-1 in-data-sheet:text-base"
						disabled={send === null || loopStopped}
						onClick={stopLoop}
					>
						<SquareIcon data-icon="inline-start" />
						Stop
					</Button>
				)}
				{state.running && (
					<Button
						size="sm"
						variant="outline"
						className="gap-1.5 in-data-sheet:h-11 in-data-sheet:flex-1 in-data-sheet:text-base"
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
