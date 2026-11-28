import type {
	ConversationState,
	Limit,
	Setting,
} from "@splates/server/conversations";
import { useReactive } from "core/react";
import { type JSX, useEffect, useRef } from "react";
import { cn } from "#web/lib/utils.ts";
import { AgentMark } from "./agent-icons";
import type { AgentChoice, ConversationFeed } from "./conversation-feed";
import { useMinute } from "./hooks/use-minute";
import { Meter } from "./meter";
import {
	ago,
	antigravityModelLimits,
	limitRow,
	limitsOf,
	pacedReset,
	QuotaWarning,
	saidAt,
} from "./plan-limits";
import { WidgetCard } from "./widget-card";

/**
 * The current model family's quota limits as a widget card beside an open
 * conversation: stacked meters with usage percentage, warning/alarm colors,
 * and reset countdowns. Hidden when the agent has reported no limits.
 */
export function QuotaCard({
	conversation,
	agent,
	feed,
	open,
}: {
	conversation: ConversationState;
	/** The agent's display name. */
	agent: string;
	feed: ConversationFeed;
	/** Refreshes pulled limits only once the widgets panel is open. */
	open: boolean;
}): JSX.Element | null {
	const last = useRef<{ choice: AgentChoice | undefined; raw: Limit[] } | null>(
		null,
	);
	// Keep the snapshot stable while other conversations stream text without
	// changing this agent's limits, so the open thread does not re-render.
	const { choice, raw } = useReactive(
		feed,
		(each) => {
			const nextChoice = each.agents.find(
				(item) => item.id === conversation.agent,
			);
			const nextRaw = limitsOf(
				each.agents,
				each.conversations,
				conversation.agent,
			).filter((item) => !item.window.startsWith("cap:"));
			if (
				last.current !== null &&
				last.current.choice === nextChoice &&
				sameLimits(last.current.raw, nextRaw)
			) {
				return last.current;
			}
			const snapshot = { choice: nextChoice, raw: nextRaw };
			last.current = snapshot;
			return snapshot;
		},
		["changed"],
	);
	const now = useMinute();
	// Codex, Kimi and Antigravity are asked for fresh limits when widgets open;
	// the server throttles each agent to once per LIMITS_FRESH.
	useEffect(() => {
		if (open) {
			void feed.refreshLimits();
		}
	}, [feed, open]);

	const { limits, at } = selectQuotaLimits(conversation, choice, raw);
	if (limits.length === 0) {
		return null;
	}
	return (
		<WidgetCard
			label="quota limits"
			icon={
				<AgentMark agent={conversation.agent} className="size-4 shrink-0" />
			}
			title={`${agent} quota`}
			aside={
				<>
					<QuotaWarning limits={limits} now={now} className="-mr-1" />
					{at !== null && ago(at, now)}
				</>
			}
		>
			<ul className="flex flex-col gap-2 px-3 pt-0.5 pb-2">
				{limits.map((limit) => {
					const row = limitRow(limit, now);
					return (
						<li
							key={limit.window}
							aria-label={row.name}
							className="flex flex-col gap-1 tabular-nums"
						>
							<div className="flex items-baseline justify-between gap-2 text-sm leading-tight">
								<span className="min-w-0 truncate">{row.name}</span>
								<span
									className={cn(
										"shrink-0 font-medium text-xs",
										row.tone === "warning" && "text-warning",
										row.tone === "destructive" && "text-destructive",
									)}
								>
									{Math.round(row.used * 100)}%
								</span>
							</div>
							<Meter used={row.used} className="block w-full" />
							{row.reset !== "" && (
								<span className="text-muted-foreground text-[11px] leading-tight">
									{pacedReset(row)}
								</span>
							)}
						</li>
					);
				})}
			</ul>
		</WidgetCard>
	);
}

/** The quota limits to show for `conversation`, and when the newest was reported. */
export function quotaLimitsFor(
	conversation: Pick<
		ConversationState,
		"agent" | "settings" | "autoPick" | "usage"
	>,
	agents: AgentChoice[],
	conversations: ConversationState[],
): { limits: Limit[]; at: number | null } {
	const raw = limitsOf(agents, conversations, conversation.agent).filter(
		(each) => !each.window.startsWith("cap:"),
	);
	const choice = agents.find((each) => each.id === conversation.agent);
	return selectQuotaLimits(conversation, choice, raw);
}

function selectQuotaLimits(
	conversation: Pick<
		ConversationState,
		"agent" | "settings" | "autoPick" | "usage"
	>,
	choice: AgentChoice | undefined,
	raw: Limit[],
): { limits: Limit[]; at: number | null } {
	if (conversation.agent !== "antigravity") {
		return { limits: raw, at: saidAt(raw) };
	}
	const setting =
		conversation.settings.find(isModelSetting) ??
		choice?.settings.find(isModelSetting);
	const model = setting?.current ?? conversation.autoPick?.model ?? "";
	const matched = antigravityModelLimits(raw, model);
	const single = matched.length === 1 ? matched[0] : undefined;
	const limits =
		single !== undefined &&
		single.window === "Antigravity quota" &&
		model !== ""
			? [{ ...single, window: modelLabel(model, choice, setting) }]
			: matched;
	return { limits, at: saidAt(limits) };
}

function sameLimits(one: readonly Limit[], other: readonly Limit[]): boolean {
	if (one.length !== other.length) {
		return false;
	}
	return one.every((each, index) => {
		const candidate = other[index];
		return (
			candidate !== undefined &&
			each.window === candidate.window &&
			each.used === candidate.used &&
			each.resets === candidate.resets &&
			each.at === candidate.at
		);
	});
}

function isModelSetting(setting: Setting): boolean {
	return setting.category === "model" || setting.id === "model";
}

/** Human-readable name for a legacy per-model Antigravity bucket. */
function modelLabel(
	model: string,
	choice: AgentChoice | undefined,
	setting: Setting | undefined,
): string {
	const fromRoster = choice?.models?.find((each) => each.id === model)?.name;
	if (fromRoster !== undefined) {
		return fromRoster;
	}
	const fromSetting = setting?.options.find(
		(each) => each.value === model,
	)?.name;
	return fromSetting === undefined
		? "Antigravity quota"
		: fromSetting.replace(/ \([^)]*\)$/, "");
}
