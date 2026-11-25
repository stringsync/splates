import { useAuiState } from "@assistant-ui/react";
import {
	EVAL_BUDGET_PRESETS,
	EVAL_TOP_UP_PRESETS,
	type EvalBudgetView,
} from "@splates/server/evals/browser";
import type { PermissionProposal } from "@splates/server/plans";
import {
	EVAL_BUDGET_APPROVED,
	EVAL_BUDGET_DECLINED,
} from "@splates/server/plans/browser";
import { BanIcon, CheckIcon, CircleDollarSignIcon } from "lucide-react";
import { type JSX, useContext, useEffect, useRef, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { Input } from "#web/components/ui/input.tsx";
import { cn } from "#web/lib/utils.ts";
import { answerEvalBudget, evalBudget } from "./api";
import { CardBox, useCardDictationTurn } from "./card-box";
import { useCardReply, useKept } from "./card-reply";
import { CardSection } from "./card-section";
import { CardBody, CardShell } from "./card-shell";
import { dollars } from "./eval-status";
import { EvalsConversation } from "./evals-card";
import { PendingSpinner, useShowPending } from "./pending";
import { Refusal, useRefusal } from "./refusal";

/** The key naming an eval budget card, as the server records its answer. */
export function evalBudgetCardKey(
	proposal: PermissionProposal,
	conversation: string | null,
	message: string | null,
): string {
	return `budget:${conversation ?? ""}:${message ?? ""}:${proposal.title ?? ""}:${proposal.budget?.usd ?? ""}`;
}

/**
 * An agent's ask for an eval budget: dollars its conversation's rounds may
 * spend, which start by themselves while they fit. The person picks an
 * amount and approves, or declines; asked again once the budget runs short,
 * it shows what is spent and adds to it. Answered, it folds to a meter.
 */
export function EvalBudgetCard({
	proposal,
}: {
	proposal: PermissionProposal;
}): JSX.Element {
	const conversation = useContext(EvalsConversation);
	const message = useAuiState((state) => state.message.id);
	const key = evalBudgetCardKey(proposal, conversation, message);
	const asked = proposal.budget?.usd ?? null;
	const round = proposal.budget?.round ?? null;
	const { reply, sent } = useCardReply();
	const send = reply?.send ?? null;
	const { refusal, attempt } = useRefusal();
	const [budget, setBudget] = useState<EvalBudgetView | null>(null);
	const [busy, setBusy] = useState<"approve" | "decline" | null>(null);
	const showBusy = useShowPending(busy !== null);
	const kept = useKept(`eval-budget:${key}`, sent);
	const [more, setMore] = useState(kept.read);
	const written = useRef(more);
	const panel = useRef<HTMLDivElement>(null);
	const turn = useCardDictationTurn(panel);
	useEffect(() => {
		if (conversation === null) {
			return;
		}
		void attempt(
			evalBudget(conversation).then(setBudget),
			"Could not read the budget",
		);
	}, [conversation, attempt]);
	const topUp = budget !== null && budget.usd > 0 && !(key in budget.answers);
	const presets = [
		...new Set(
			[...(topUp ? EVAL_TOP_UP_PRESETS : EVAL_BUDGET_PRESETS), asked ?? 0]
				.filter((each) => each > 0)
				.toSorted((first, second) => first - second),
		),
	];
	const [picked, setPicked] = useState<number | null>(asked);
	const [custom, setCustom] = useState("");
	const customUsd = Number(custom);
	const amount =
		custom.trim() !== ""
			? Number.isFinite(customUsd) && customUsd > 0
				? Math.round(customUsd * 100) / 100
				: null
			: picked;
	const answer =
		budget !== null && key in budget.answers
			? budget.answers[key]
			: sent?.startsWith(EVAL_BUDGET_DECLINED)
				? null
				: undefined;
	const answered =
		answer !== undefined || sent?.startsWith(EVAL_BUDGET_APPROVED) === true;
	const left = budget === null ? 0 : Math.max(0, budget.usd - budget.spent);
	const note = (): string => written.current.trim();
	const respond = (usd: number | null): void => {
		if (send === null || conversation === null) {
			return;
		}
		setBusy(usd === null ? "decline" : "approve");
		void attempt(
			answerEvalBudget(conversation, key, usd)
				.then(async (now) => {
					setBudget(now);
					const stands =
						usd === null
							? ""
							: `\n\nAdded ${money(usd)}: ${money(Math.max(0, now.usd - now.spent))} of ${money(now.usd)} left.`;
					const words = `${usd === null ? EVAL_BUDGET_DECLINED : EVAL_BUDGET_APPROVED}${stands}`;
					await send(
						note() === ""
							? words
							: `${words}\n\n> **Anything else?**\n\n${note()}`,
					);
				})
				.finally(() => setBusy(null)),
			usd === null ? "Not declined" : "Not approved",
		);
	};
	if (answered) {
		const added = typeof answer === "number" ? answer : null;
		return (
			<CardShell
				label="eval budget"
				Icon={CircleDollarSignIcon}
				title={
					added === null && answer === null
						? "Eval budget declined"
						: `Eval budget approved${added === null ? "" : ` · ${dollars(added)}`}`
				}
				tone={answer === null ? "neutral" : "success"}
				aside={
					budget !== null && budget.usd > 0 ? (
						<span className="text-muted-foreground text-xs tabular-nums">
							{dollars(round2(budget.spent))} of {dollars(budget.usd)} spent
						</span>
					) : undefined
				}
				folded
			>
				{proposal.body !== "" && <CardBody text={proposal.body} />}
				{budget !== null && budget.usd > 0 && (
					<Meter spent={budget.spent} usd={budget.usd} className="mx-4 mb-3" />
				)}
			</CardShell>
		);
	}
	return (
		<CardShell
			label="eval budget"
			Icon={CircleDollarSignIcon}
			title={topUp ? "More eval budget" : "Eval budget"}
			tone="eval"
			aside={
				asked !== null ? (
					<span className="text-muted-foreground text-xs tabular-nums">
						Asks {topUp ? "+" : ""}
						{dollars(asked)}
					</span>
				) : undefined
			}
		>
			{proposal.body !== "" && <CardBody text={proposal.body} />}
			<div className="mx-4 mb-3 flex flex-col gap-3">
				{topUp && budget !== null && (
					<Meter spent={budget.spent} usd={budget.usd} />
				)}
				{round !== null && (
					<dl className="m-0 grid grid-cols-3 gap-3 rounded-lg bg-muted/60 p-3 @max-md:grid-cols-2">
						<Stat term="A round" value={`up to ${money(round)}`} />
						{amount !== null && (
							<Stat
								term="Buys"
								value={rounds(Math.floor((left + (amount ?? 0)) / round))}
								about="at the most a round costs"
							/>
						)}
						{topUp && amount !== null && (
							<Stat term="Left after" value={dollars(round2(left + amount))} />
						)}
					</dl>
				)}
				<fieldset
					aria-label="Budget"
					className="m-0 flex flex-col gap-2 border-0 p-0"
				>
					<legend className="mb-2 font-medium text-sm">
						{topUp ? "Add" : "Budget"}
					</legend>
					<div className="flex flex-wrap items-center gap-1.5">
						{presets.map((usd) => (
							<Button
								key={usd}
								size="sm"
								variant={
									custom.trim() === "" && picked === usd ? "default" : "outline"
								}
								aria-pressed={custom.trim() === "" && picked === usd}
								className="tabular-nums"
								onClick={() => {
									setCustom("");
									setPicked(usd);
								}}
							>
								{topUp ? "+" : ""}
								{dollars(usd)}
							</Button>
						))}
						<Input
							aria-label="Custom amount in dollars"
							inputMode="decimal"
							placeholder="Custom $"
							value={custom}
							onChange={(event) => setCustom(event.target.value)}
							className="h-8 w-28 tabular-nums"
						/>
					</div>
				</fieldset>
			</div>
			{send !== null && (
				<div ref={panel} className="rule-t px-4 py-4">
					<CardSection
						label="Anything else section"
						title="Anything else?"
						ruled={false}
					>
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
					</CardSection>
				</div>
			)}
			<div className="flex flex-wrap items-center justify-end gap-2 rule-t px-4 py-2.5">
				<span className="mr-auto text-muted-foreground text-xs @max-md:basis-full">
					Rounds start by themselves while they fit; past it, the agent asks
					again.
				</span>
				<Button
					size="sm"
					variant="outline"
					disabled={send === null || busy !== null}
					onClick={() => turn(() => respond(null))}
					className="gap-1.5 in-data-sheet:h-11 in-data-sheet:text-base"
				>
					{busy === "decline" && showBusy ? (
						<PendingSpinner shown />
					) : (
						<BanIcon data-icon="inline-start" />
					)}
					Decline
				</Button>
				<Button
					size="sm"
					disabled={send === null || busy !== null || amount === null}
					onClick={() => amount !== null && turn(() => respond(amount))}
					className="gap-1.5 in-data-sheet:h-11 in-data-sheet:flex-1 in-data-sheet:text-base"
				>
					{busy === "approve" && showBusy ? (
						<PendingSpinner shown />
					) : (
						<CheckIcon data-icon="inline-start" />
					)}
					{amount === null
						? "Approve"
						: `${topUp ? "Add" : "Approve"} ${dollars(amount)}`}
				</Button>
			</div>
			<Refusal refusal={refusal} className="mx-4 mb-3" />
		</CardShell>
	);
}

/** What is spent of the budget, as a bar. */
function Meter({
	spent,
	usd,
	className,
}: {
	spent: number;
	usd: number;
	className?: string;
}): JSX.Element {
	const share = usd > 0 ? Math.min(1, spent / usd) : 1;
	return (
		<div className={cn("flex flex-col gap-1.5", className)}>
			<div className="flex justify-between text-xs tabular-nums">
				<span>
					<span className="font-semibold">{money(spent)}</span>{" "}
					<span className="text-muted-foreground">of {dollars(usd)} spent</span>
				</span>
				<span className="text-muted-foreground">
					{money(Math.max(0, usd - spent))} left
				</span>
			</div>
			<div aria-hidden className="h-1.5 overflow-hidden rounded-full bg-muted">
				<div
					className={cn(
						"h-full rounded-full",
						share >= 1 ? "bg-destructive" : "bg-foreground",
					)}
					style={{ width: `${share * 100}%` }}
				/>
			</div>
		</div>
	);
}

function Stat({
	term,
	value,
	about,
}: {
	term: string;
	value: string;
	about?: string;
}): JSX.Element {
	return (
		<div className="flex min-w-0 flex-col gap-0.5">
			<dt className="font-semibold text-[11px] text-muted-foreground uppercase tracking-[0.08em]">
				{term}
			</dt>
			<dd className="m-0 font-semibold text-[15px] tabular-nums">{value}</dd>
			{about !== undefined && (
				<dd className="m-0 text-muted-foreground text-xs">{about}</dd>
			)}
		</div>
	);
}

function rounds(count: number): string {
	return count === 1 ? "about 1 round" : `about ${count} rounds`;
}

function money(usd: number): string {
	return `$${round2(usd).toFixed(2)}`;
}

function round2(usd: number): number {
	return Math.round(usd * 100) / 100;
}
