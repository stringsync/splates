import type { ConversationState, Limit } from "@splates/server/conversations";
import {
	antigravityGroups,
	antigravityModelInGroup,
} from "@splates/server/models/browser";
import { useReactive } from "core/react";
import { CircleAlertIcon, TriangleAlertIcon } from "lucide-react";
import { type JSX, useContext, useEffect, useRef, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#web/components/ui/dialog.tsx";
import { cn } from "#web/lib/utils.ts";
import { AgentMark } from "./agent-icons";
import { endedReport } from "./archive-offer";
import { settingsFor } from "./conversation-address";
import { handOffConversation } from "./conversation-api";
import type { AgentChoice, ConversationFeed } from "./conversation-feed";
import { Dispatching } from "./dispatching";
import { useMinute } from "./hooks/use-minute";
import { Meter, toneOf } from "./meter";
import {
	antigravityModelLimits,
	antigravityPlanLimits,
	limitRow,
	limitsOf,
	pacedReset,
} from "./plan-limits";
import { quotaLimitsFor } from "./quota-card";
import type { Refuse } from "./refusal";
import { ThreadBar } from "./thread-bar";

/**
 * A dismissible slim bar above the conversation composer when the active agent
 * is low on (90%+) or out of quota, offering to hand off to another available
 * agent from a dropdown that disables out-of-quota agents.
 */
export function QuotaHandoffBar({
	conversation,
	agent,
	feed,
	refused,
}: {
	conversation: ConversationState;
	/** The active agent's display name. */
	agent: string;
	feed: ConversationFeed;
	refused: Refuse;
}): JSX.Element | null {
	const context = useContext(Dispatching);
	const now = useMinute();
	const [handingOff, setHandingOff] = useState(false);
	const [open, setOpen] = useState(false);
	const [dismissedKey, setDismissedKey] = useState<string | null>(() =>
		readDismissed(conversation.id),
	);

	useEffect(() => {
		setDismissedKey(readDismissed(conversation.id));
	}, [conversation.id]);

	const last = useRef<{
		agents: AgentChoice[];
		conversations: ConversationState[];
	} | null>(null);
	const snapshot = useReactive(
		feed,
		(each) => {
			if (
				last.current !== null &&
				last.current.agents === each.agents &&
				sameLimitSources(last.current.conversations, each.conversations)
			) {
				return last.current;
			}
			const next = {
				agents: each.agents,
				conversations: each.conversations,
			};
			last.current = next;
			return next;
		},
		["changed"],
	);

	if (
		conversation.archived ||
		context === null ||
		isConversationEnded(conversation)
	) {
		return null;
	}

	const state = quotaHandoffState(
		conversation,
		snapshot.agents,
		snapshot.conversations,
		now,
	);
	if (state === null || dismissedKey === state.cycleKey) {
		return null;
	}

	const currentChoice = snapshot.agents.find(
		(each) => each.id === conversation.agent,
	);
	const currentModel =
		conversation.settings.find(
			(each) => each.category === "model" || each.id === "model",
		)?.current ??
		currentChoice?.settings.find(
			(each) => each.category === "model" || each.id === "model",
		)?.current ??
		conversation.autoPick?.model;
	const candidates = candidateAgentQuotas(
		conversation.agent,
		snapshot.agents,
		snapshot.conversations,
		now,
		currentModel ?? undefined,
	);
	if (candidates.length === 0) {
		return null;
	}

	const out = state.severity === "out";
	const pct = Math.round(state.used * 100);
	const subtitle = out
		? state.resetShort !== ""
			? `${state.window} limit · ${state.resetShort}`
			: `${state.window} limit reached`
		: state.resetShort !== ""
			? `${pct}% of ${state.window} · ${state.resetShort}`
			: `${pct}% of ${state.window} used`;

	const dismiss = (): void => {
		setOpen(false);
		writeDismissed(conversation.id, state.cycleKey);
		setDismissedKey(state.cycleKey);
	};

	const handOff = (targetAgent: string, targetModel?: string): void => {
		if (handingOff) {
			return;
		}
		setOpen(false);
		setHandingOff(true);
		handOffConversation(conversation.id)
			.then(({ state: archived, prompt }) => {
				if (archived !== undefined) {
					feed.put(archived);
				}
				return context.dispatch.beginWith(
					targetModel === undefined
						? { agent: targetAgent }
						: { agent: targetAgent, model: targetModel },
					conversation.task,
					prompt,
				);
			})
			.then(context.open)
			.catch((error: unknown) => {
				setHandingOff(false);
				refused("Not handed off", error);
			});
	};

	const { limits: currentLimits } = quotaLimitsFor(
		conversation,
		snapshot.agents,
		snapshot.conversations,
	);

	return (
		<aside aria-label="Quota handoff">
			<ThreadBar
				Icon={out ? CircleAlertIcon : TriangleAlertIcon}
				iconTone={out ? "destructive" : "warning"}
				disabled={handingOff}
				onPress={() => setOpen(true)}
				cta={handingOff ? "Handing off…" : "Hand off"}
				label={
					<span>
						{out
							? `${agent} is out of quota`
							: `${agent} is low on quota · ${pct}%`}
						<span className="hidden @min-[26rem]:inline">
							{out ? ` · ${state.window}` : ` of ${state.window}`}
						</span>
					</span>
				}
			/>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent className="max-h-[85%] overflow-y-auto sm:max-w-md">
					<DialogHeader className="min-w-0">
						<DialogTitle className="flex min-w-0 items-center gap-2">
							<AgentMark
								agent={conversation.agent}
								className="size-4 shrink-0"
							/>
							<span className="min-w-0 truncate">
								{out ? `${agent} is out of quota` : `${agent} is low on quota`}
							</span>
						</DialogTitle>
						<DialogDescription className="tabular-nums">
							{subtitle}
						</DialogDescription>
					</DialogHeader>
					{currentLimits.length > 0 && (
						<ul
							aria-label="Current quota"
							className="flex min-w-0 flex-col gap-2.5 rounded-lg border bg-muted/30 p-3"
						>
							{currentLimits.map((limit) => {
								const row = limitRow(limit, now);
								const resetLine = pacedReset(row);
								return (
									<li
										key={limit.window}
										aria-label={row.name}
										className="flex min-w-0 flex-col gap-1 tabular-nums"
									>
										<div className="flex items-baseline justify-between gap-2 text-xs">
											<span className="min-w-0 truncate font-medium">
												{row.name}
											</span>
											<span
												className={cn(
													"shrink-0 font-medium",
													row.tone === "warning" && "text-warning",
													row.tone === "destructive" && "text-destructive",
												)}
											>
												{Math.round(row.used * 100)}%
											</span>
										</div>
										<Meter used={row.used} className="block w-full" />
										{resetLine !== "" && (
											<span className="text-muted-foreground text-[11px] leading-tight">
												{resetLine}
											</span>
										)}
									</li>
								);
							})}
						</ul>
					)}
					<div className="flex min-w-0 flex-col gap-2">
						<p className="font-medium text-muted-foreground text-xs">
							Hand off to
						</p>
						<ul
							aria-label="Candidate agents"
							className="flex min-w-0 flex-col gap-1.5"
						>
							{candidates.map(
								({
									key,
									agent: candidate,
									label,
									model,
									out: exhausted,
									used,
									tone,
								}) => (
									<li key={key} className="min-w-0">
										<button
											type="button"
											disabled={exhausted || handingOff}
											onClick={() => handOff(candidate.id, model)}
											className="flex min-h-11 w-full min-w-0 cursor-pointer flex-col gap-1.5 rounded-lg border bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-60"
										>
											<div className="flex w-full items-center gap-2">
												<AgentMark agent={candidate.id} name={candidate.name} />
												<span className="min-w-0 flex-1 truncate font-medium text-sm">
													{label}
												</span>
												{exhausted ? (
													<span className="shrink-0 font-medium text-destructive text-xs">
														Out of quota
													</span>
												) : used !== null ? (
													<span
														className={cn(
															"shrink-0 text-xs tabular-nums",
															tone === "destructive"
																? "font-medium text-destructive"
																: tone === "warning"
																	? "font-medium text-warning"
																	: "text-muted-foreground",
														)}
													>
														{Math.round(used * 100)}% used
													</span>
												) : null}
											</div>
											{used !== null && (
												<Meter used={used} className="block w-full" />
											)}
										</button>
									</li>
								),
							)}
						</ul>
					</div>
					<DialogFooter>
						<Button type="button" variant="outline" onClick={dismiss}>
							Dismiss for cycle
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</aside>
	);
}

/** Share used at which the bar warns that the agent is about to run out of quota. */
export const QUOTA_LOW_AT = 0.9;

/** Share used at which an agent is considered out of quota. */
export const QUOTA_OUT_AT = 1;

/** How the active conversation's quota stands for the handoff bar. */
export interface QuotaHandoffState {
	severity: "low" | "out";
	/** Display name of the tightest window (e.g. "5-hour", "Weekly"). */
	window: string;
	/** Share used, 0 to 1, accounting for expired resets. */
	used: number;
	/** Short reset phrase for the subtitle (e.g. "resets 2:00 PM"), or empty. */
	resetShort: string;
	/** Identifies this severity and reset cycle so dismissal resets on escalation or reset. */
	cycleKey: string;
}

/** Quota availability of another agent (or independent quota group) offered in the handoff dropdown. */
export interface CandidateAgentQuota {
	/** Stable key for the option (e.g. `"codex"`, `"antigravity:Gemini Models"`). */
	key: string;
	agent: AgentChoice;
	/** Display label in the dropdown (e.g. `"Codex"`, `"Antigravity · Gemini"`). */
	label: string;
	/** Model to start on when handing off to a specific quota group. */
	model?: string;
	out: boolean;
	/** Highest active share used across the candidate's windows, or null when unreported. */
	used: number | null;
	tone: "warning" | "destructive" | null;
}

/**
 * Computes whether `conversation`'s active agent is low on or out of quota at
 * `now`, or null when it still has room (or reports no limits).
 */
export function quotaHandoffState(
	conversation: Pick<
		ConversationState,
		"agent" | "settings" | "autoPick" | "usage"
	>,
	agents: AgentChoice[],
	conversations: ConversationState[],
	now: number,
): QuotaHandoffState | null {
	const { limits } = quotaLimitsFor(conversation, agents, conversations);
	if (limits.length === 0) {
		return null;
	}
	const candidates = limits.map((limit) => ({
		limit,
		row: limitRow(limit, now),
	}));
	const tightest = candidates.reduce((best, each) => {
		if (each.row.used > best.row.used) {
			return each;
		}
		if (each.row.used === best.row.used) {
			const bestReset = best.limit.resets ?? "";
			const eachReset = each.limit.resets ?? "";
			if (eachReset !== "" && (bestReset === "" || eachReset < bestReset)) {
				return each;
			}
		}
		return best;
	});
	if (tightest.row.used < QUOTA_LOW_AT) {
		return null;
	}
	const severity = tightest.row.used >= QUOTA_OUT_AT ? "out" : "low";
	return {
		severity,
		window: tightest.row.name,
		used: tightest.row.used,
		resetShort: shortReset(tightest.row.reset),
		cycleKey: `${severity}:${tightest.limit.window}:${tightest.limit.resets ?? ""}`,
	};
}

/**
 * Other agents (and independent quota groups of the current agent, for
 * Antigravity) available to hand off to, with each one's quota status so
 * out-of-quota targets can be disabled.
 */
export function candidateAgentQuotas(
	currentAgent: string,
	agents: AgentChoice[],
	conversations: ConversationState[],
	now: number,
	currentModel?: string,
): CandidateAgentQuota[] {
	return agents.flatMap((agent): CandidateAgentQuota[] => {
		const raw = limitsOf(agents, conversations, agent.id).filter(
			(limit) => !limit.window.startsWith("cap:"),
		);
		if (agent.id === "antigravity") {
			const groups = antigravityGroups(raw);
			if (groups.length > 0) {
				const sameAgent = agent.id === currentAgent;
				if (sameAgent && (currentModel === undefined || currentModel === "")) {
					return [];
				}
				return groups.flatMap(({ group, label, limits }) => {
					if (
						sameAgent &&
						currentModel !== undefined &&
						antigravityModelInGroup(currentModel, group)
					) {
						return [];
					}
					const rows = limits.map((limit) => limitRow(limit, now));
					const used = Math.max(...rows.map((row) => row.used));
					const model = modelForAntigravityGroup(
						agent,
						agents,
						conversations,
						group,
					);
					return [
						{
							key: `${agent.id}:${group}`,
							agent,
							label: `${agent.name} · ${label}`,
							...(model === undefined ? {} : { model }),
							out: used >= QUOTA_OUT_AT,
							used,
							tone: toneOf(used),
						},
					];
				});
			}
		}
		if (agent.id === currentAgent) {
			return [];
		}
		const limits = limitsForCandidate(agent, agents, conversations, raw);
		if (limits.length === 0) {
			return [
				{
					key: agent.id,
					agent,
					label: agent.name,
					out: false,
					used: null,
					tone: null,
				},
			];
		}
		const rows = limits.map((limit) => limitRow(limit, now));
		const used = Math.max(...rows.map((row) => row.used));
		return [
			{
				key: agent.id,
				agent,
				label: agent.name,
				out: used >= QUOTA_OUT_AT,
				used,
				tone: toneOf(used),
			},
		];
	});
}

/** Picks an Antigravity model id belonging to `group`, preferring the last selected one. */
function modelForAntigravityGroup(
	agent: AgentChoice,
	agents: AgentChoice[],
	conversations: ConversationState[],
	group: string,
): string | undefined {
	const settings = settingsFor("antigravity", agents, conversations);
	const modelSetting = settings.find(
		(each) => each.category === "model" || each.id === "model",
	);
	if (
		modelSetting !== undefined &&
		modelSetting.current !== "" &&
		antigravityModelInGroup(modelSetting.current, group)
	) {
		return modelSetting.current;
	}
	const offered = modelSetting?.options.find(
		(each) =>
			antigravityModelInGroup(each.value, group) ||
			antigravityModelInGroup(each.name, group),
	);
	if (offered !== undefined) {
		return offered.value;
	}
	const roster = agent.models?.find(
		(each) =>
			antigravityModelInGroup(each.id, group) ||
			antigravityModelInGroup(each.name, group),
	);
	return roster?.id;
}

/** Limits relevant to `agent` when starting a new conversation with it. */
function limitsForCandidate(
	agent: AgentChoice,
	agents: AgentChoice[],
	conversations: ConversationState[],
	raw: Limit[],
): Limit[] {
	if (agent.id !== "antigravity") {
		return raw;
	}
	const settings = settingsFor("antigravity", agents, conversations);
	const model = settings.find(
		(each) => each.category === "model" || each.id === "model",
	)?.current;
	if (model !== undefined && model !== "") {
		return antigravityModelLimits(raw, model);
	}
	return antigravityPlanLimits(raw);
}

/** Keeps "resets 2:00 PM" from "resets 2:00 PM, in 1h 12m"; drops expired "reset ...". */
function shortReset(reset: string): string {
	if (!reset.startsWith("resets ")) {
		return "";
	}
	const comma = reset.indexOf(", ");
	return comma === -1 ? reset : reset.slice(0, comma);
}

/** Whether the conversation is already finished (Done or Removed) and idle. */
function isConversationEnded(conversation: ConversationState): boolean {
	if (
		(conversation.status !== "idle" && conversation.status !== "stopped") ||
		conversation.ask !== null
	) {
		return false;
	}
	const report = endedReport(conversation);
	return report !== null && report.ending !== "deferred";
}

function sameLimitSources(
	one: readonly ConversationState[],
	other: readonly ConversationState[],
): boolean {
	if (one.length !== other.length) {
		return false;
	}
	return one.every((each, index) => {
		const candidate = other[index];
		return (
			candidate !== undefined &&
			each.id === candidate.id &&
			each.agent === candidate.agent &&
			each.usage.limits === candidate.usage.limits
		);
	});
}

const DISMISSED_PREFIX = "splates.quota-handoff.dismissed.";

function readDismissed(conversationId: string): string | null {
	try {
		return sessionStorage.getItem(`${DISMISSED_PREFIX}${conversationId}`);
	} catch {
		return null;
	}
}

function writeDismissed(conversationId: string, cycleKey: string): void {
	try {
		sessionStorage.setItem(`${DISMISSED_PREFIX}${conversationId}`, cycleKey);
	} catch {
		// Ignore unavailable storage (private browsing or SSR).
	}
}
