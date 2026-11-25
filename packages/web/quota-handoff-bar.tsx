import type { ConversationState, Limit } from "@splates/server/conversations";
import { useReactive } from "core/react";
import {
	ChevronDownIcon,
	CircleAlertIcon,
	TriangleAlertIcon,
	XIcon,
} from "lucide-react";
import { type JSX, useContext, useEffect, useRef, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from "#web/components/ui/dropdown-menu.tsx";
import { cn } from "#web/lib/utils.ts";
import { AgentMark } from "./agent-icons";
import { touchItems } from "./board";
import { settingsFor } from "./conversation-address";
import { handOffConversation } from "./conversation-api";
import type { AgentChoice, ConversationFeed } from "./conversation-feed";
import { Dispatching } from "./dispatching";
import { useMinute } from "./hooks/use-minute";
import { toneOf } from "./meter";
import {
	antigravityModelLimits,
	antigravityPlanLimits,
	limitRow,
	limitsOf,
} from "./plan-limits";
import { quotaLimitsFor } from "./quota-card";
import type { Refuse } from "./refusal";

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

	if (conversation.archived || context === null) {
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

	const candidates = candidateAgentQuotas(
		conversation.agent,
		snapshot.agents,
		snapshot.conversations,
		now,
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
		writeDismissed(conversation.id, state.cycleKey);
		setDismissedKey(state.cycleKey);
	};

	const handOff = (targetAgent: string): void => {
		if (handingOff) {
			return;
		}
		setHandingOff(true);
		handOffConversation(conversation.id)
			.then(({ state: archived, prompt }) => {
				if (archived !== undefined) {
					feed.put(archived);
				}
				return context.dispatch.beginWith(
					{ agent: targetAgent },
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

	return (
		<aside aria-label="Quota handoff">
			<section
				data-card
				className="relative flex items-center gap-3 overflow-hidden rounded-lg border bg-card px-4 py-2.5 text-sm shadow-xs"
			>
				{out ? (
					<CircleAlertIcon
						aria-hidden
						className="size-4 shrink-0 text-destructive"
					/>
				) : (
					<TriangleAlertIcon
						aria-hidden
						className="size-4 shrink-0 text-warning"
					/>
				)}
				<span className="flex min-w-0 flex-1 flex-col gap-0.5">
					<span className="truncate">
						{out ? `${agent} is out of quota` : `${agent} is low on quota`}
					</span>
					<span className="truncate text-muted-foreground text-xs tabular-nums">
						{subtitle}
					</span>
				</span>
				<div className="-mr-1.5 flex shrink-0 items-center gap-1">
					<DropdownMenu>
						<DropdownMenuTrigger
							render={
								<Button
									size="sm"
									variant="outline"
									disabled={handingOff}
									className="bg-background"
								/>
							}
						>
							{handingOff ? "Handing off…" : "Hand off"}
							<ChevronDownIcon
								data-icon="inline-end"
								className="text-muted-foreground"
							/>
						</DropdownMenuTrigger>
						<DropdownMenuContent
							side="top"
							align="end"
							className={cn("w-56", touchItems)}
						>
							<DropdownMenuGroup>
								<DropdownMenuLabel>Hand off to</DropdownMenuLabel>
								{candidates.map(
									({ agent: candidate, out: exhausted, used, tone }) => (
										<DropdownMenuItem
											key={candidate.id}
											disabled={exhausted || handingOff}
											onClick={() => handOff(candidate.id)}
										>
											<AgentMark agent={candidate.id} name={candidate.name} />
											<span className="min-w-0 flex-1 truncate">
												{candidate.name}
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
										</DropdownMenuItem>
									),
								)}
							</DropdownMenuGroup>
						</DropdownMenuContent>
					</DropdownMenu>
					<Button
						size="icon-sm"
						variant="ghost"
						aria-label="Dismiss quota handoff"
						onClick={dismiss}
						className="text-muted-foreground hover:text-foreground"
					>
						<XIcon />
					</Button>
				</div>
			</section>
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

/** Quota availability of another agent offered in the handoff dropdown. */
export interface CandidateAgentQuota {
	agent: AgentChoice;
	out: boolean;
	/** Highest active share used across the agent's windows, or null when unreported. */
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
 * Other agents available to hand off to, with each one's quota status so
 * out-of-quota agents can be disabled.
 */
export function candidateAgentQuotas(
	currentAgent: string,
	agents: AgentChoice[],
	conversations: ConversationState[],
	now: number,
): CandidateAgentQuota[] {
	return agents
		.filter((each) => each.id !== currentAgent)
		.map((agent) => {
			const raw = limitsOf(agents, conversations, agent.id).filter(
				(limit) => !limit.window.startsWith("cap:"),
			);
			const limits = limitsForCandidate(agent, agents, conversations, raw);
			if (limits.length === 0) {
				return { agent, out: false, used: null, tone: null };
			}
			const rows = limits.map((limit) => limitRow(limit, now));
			const used = Math.max(...rows.map((row) => row.used));
			return {
				agent,
				out: used >= QUOTA_OUT_AT,
				used,
				tone: toneOf(used),
			};
		});
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
