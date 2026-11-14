import { useAuiState } from "@assistant-ui/react";
import type { PermissionProposal } from "@splates/server/plans";
import { RUN_DENIED } from "@splates/server/plans/browser";
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
import { EvalBudgetLine } from "./eval-budget-line";
import { EvalRunRecord } from "./eval-card-record";
import { EvalCardScenarios } from "./eval-card-scenarios";
import { EvalTimer } from "./eval-elapsed";
import { EvalRun } from "./eval-run";
import { EvalRunCue } from "./eval-run-cue";
import { SettingField } from "./eval-setting-field";
import { ceilCents, planText } from "./eval-status";
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
			usd: each.usd,
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
	const kept = useKept(`run-evals:${run.key}`, sent);
	const [more, setMore] = useState(kept.read);
	const written = useRef(more);
	const panel = useRef<HTMLDivElement>(null);
	const turn = useCardDictationTurn(panel);
	const send = reply?.send ?? null;
	const turnedDown = sent?.includes(RUN_DENIED) ?? false;
	const open = launch === null && !turnedDown;
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
	const ceilingNow =
		open && state.plan !== null && !state.plan.refused ? state.plan.usd : null;
	const overBudget =
		conversation !== null &&
		ceilingNow !== null &&
		state.usd < ceilCents(ceilingNow);
	const note = (): string => written.current.trim();
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
			aside={
				state.running && grid !== null ? <EvalTimer grid={grid} /> : undefined
			}
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
					<CardSection label="run" title="Run" className="mx-4 mb-3 text-sm">
						<div className="flex flex-col gap-2">
							<fieldset
								aria-label="run settings"
								className="grid grid-cols-2 gap-2 text-xs"
							>
								<SettingField
									label="Repetitions per scenario"
									aria-label="Run repetitions"
									min={1}
									defaultValue={run.ask.reps}
									placeholder="Default"
									onChange={(event) =>
										void run.repeat(Number(event.target.value))
									}
								/>
								{conversation !== null && (
									<SettingField
										label="Budget ($)"
										aria-label="Budget in dollars"
										min={0.01}
										step="any"
										value={state.usd}
										onChange={(event) =>
											run.setBudget(Number(event.target.value))
										}
									/>
								)}
							</fieldset>

							{state.plan === null &&
								state.loaded &&
								state.refusal === null &&
								state.agents.some((each) => each.on) && (
									<p
										data-testid="plan-pending"
										className="text-muted-foreground text-xs"
									>
										Working out the cost…
									</p>
								)}
							{state.plan !== null && (
								<p
									data-testid="plan"
									className={
										state.plan.usd === null || state.plan.refused
											? "text-muted-foreground text-xs"
											: "font-medium text-sm"
									}
								>
									{planText(
										state.plan,
										conversation !== null ? state.usd : undefined,
									)}
								</p>
							)}
							{state.budget !== null && conversation !== null && (
								<EvalBudgetLine
									status={state.budget}
									started={false}
									usd={state.usd}
									ceiling={ceilingNow}
									onUpdate={(usd) => run.setBudget(usd)}
								/>
							)}
						</div>
					</CardSection>
				</>
			) : launch === null ? null : (
				<div className="mx-4 mb-3 flex flex-col gap-1 text-sm">
					{grid !== null && (
						<EvalRunRecord
							grid={grid}
							running={state.running}
							stopped={launch.status === "stopped"}
							budget={conversation !== null ? state.usd : null}
						/>
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
			<EvalRunCue open={open} state={state} />
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
							state.plan.refused ||
							overBudget
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
