import {
	AGENT_QUEUE_BUDGET_PRESETS,
	AGENT_QUEUE_CAP_PRESETS,
	AGENT_QUEUE_RESERVE_PRESETS,
	type AgentQueueLevel,
	type AgentQueueSettings,
	DEFAULT_AGENT_QUEUE_SETTINGS,
} from "@splates/server/queue/browser";
import { CloudIcon } from "lucide-react";
import { type JSX, useEffect, useState } from "react";
import { Card } from "#web/components/ui/card.tsx";
import { Input } from "#web/components/ui/input.tsx";
import { cn } from "#web/lib/utils.ts";
import { readAgentSettings, saveAgentSettings } from "./api";
import { Refusal, useRefusal } from "./refusal";
import type { Category } from "./settings";

const LEVELS: readonly {
	value: AgentQueueLevel;
	title: string;
	description: string;
}[] = [
	{
		value: "never",
		title: "Never",
		description: "Agents ask with a queue card, as today.",
	},
	{
		value: "safe",
		title: "Safe tasks only",
		description:
			"Small, revertible work in the same project that spends nothing outside it. Anything else still gets a queue card.",
	},
	{
		value: "any",
		title: "Any task",
		description:
			"Agents queue anything. The task still asks before costly or irreversible work.",
	},
];

const SEARCH_TEXT = [
	"agents",
	"agents may queue tasks themselves",
	"without asking you first within the limits below",
	"never safe tasks only any task queue card",
	"most an agent queues per conversation cap limit",
	"quota reserve plan window left held waiting",
	"budget tokens chain spend 2M 5M 10M",
].join(" ");

/** Whether the Settings category `category` is Agents and a search for `query` finds it. */
export function matchesAgentSettings(
	category: Category,
	query: string,
): boolean {
	if (category !== "Agents") {
		return false;
	}
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	return words.every((word) => SEARCH_TEXT.includes(word));
}

/**
 * Per-project server settings for agent auto-queue, shown in the Agents
 * section of the Settings dialog.
 */
export function AgentSettings({
	project = "this project",
}: {
	project?: string;
}): JSX.Element {
	const [value, setValue] = useState<AgentQueueSettings>(
		DEFAULT_AGENT_QUEUE_SETTINGS,
	);
	const [loaded, setLoaded] = useState(false);
	const [customOpen, setCustomOpen] = useState(false);
	const [customText, setCustomText] = useState(
		String(DEFAULT_AGENT_QUEUE_SETTINGS.perConversationCap),
	);
	const { refusal, refuse } = useRefusal();

	useEffect(() => {
		let cancelled = false;
		void readAgentSettings()
			.then((next) => {
				if (cancelled) {
					return;
				}
				setValue(next);
				setCustomText(String(next.perConversationCap));
				setCustomOpen(
					!(AGENT_QUEUE_CAP_PRESETS as readonly number[]).includes(
						next.perConversationCap,
					),
				);
				setLoaded(true);
			})
			.catch((error: unknown) => {
				if (!cancelled) {
					refuse("Could not load agent settings", error);
					setLoaded(true);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [refuse]);

	const update = async (patch: Partial<AgentQueueSettings>) => {
		const previous = value;
		setValue((current) => ({ ...current, ...patch }));
		try {
			const saved = await saveAgentSettings(patch);
			setValue(saved);
			setCustomText(String(saved.perConversationCap));
		} catch (error) {
			setValue(previous);
			refuse("Not saved", error);
		}
	};

	const isPreset = (AGENT_QUEUE_CAP_PRESETS as readonly number[]).includes(
		value.perConversationCap,
	);
	const showCustom = customOpen || !isPreset;

	return (
		<div className="flex flex-col">
			<p className="mb-4 flex items-center gap-1.5 text-muted-foreground text-xs">
				<CloudIcon className="size-3.5 shrink-0" aria-hidden="true" />
				<span>
					Saved on the server for{" "}
					<strong className="font-medium text-foreground">{project}</strong>, on
					every device. Agents can’t change these.
				</span>
			</p>

			<Refusal refusal={refusal} className="mb-3" />

			<fieldset disabled={!loaded} className="flex flex-col">
				<legend className="font-medium text-sm">
					Agents may queue tasks themselves
				</legend>
				<p className="mt-0.5 text-muted-foreground text-xs">
					Without asking you first, within the limits below.
				</p>
				<div className="mt-2.5 flex flex-col gap-1.5">
					{LEVELS.map((option) => {
						const checked = value.level === option.value;
						return (
							<label
								key={option.value}
								className={cn(
									"flex cursor-pointer items-start gap-2.5 rounded-2xl border px-4 py-3 transition-colors hover:bg-muted/50",
									checked
										? "border-primary bg-accent hover:bg-accent"
										: "border-border bg-card",
								)}
							>
								<input
									type="radio"
									name="agent-queue-level"
									value={option.value}
									checked={checked}
									onChange={() => void update({ level: option.value })}
									className="sr-only"
								/>
								<span
									aria-hidden="true"
									className={cn(
										"mt-0.5 size-4 shrink-0 rounded-full border",
										checked
											? "border-[5px] border-primary"
											: "border-[1.5px] border-input",
									)}
								/>
								<span className="min-w-0 flex-1">
									<span className="block text-sm leading-snug">
										{option.title}
									</span>
									<span className="mt-0.5 block text-muted-foreground text-xs leading-relaxed">
										{option.description}
									</span>
								</span>
							</label>
						);
					})}
				</div>
			</fieldset>

			<Card className="mt-5 rounded-2xl">
				<div className="flex flex-col divide-y">
					<div className="flex items-start gap-6 px-4 py-3.5 max-sm:flex-col max-sm:gap-2 sm:px-5 sm:py-4">
						<div className="min-w-0 flex-1">
							<div className="font-medium text-sm">
								Most an agent queues per conversation
							</div>
							<p className="mt-0.5 text-muted-foreground text-xs">
								After this, the agent asks with a queue card.
							</p>
						</div>
						<div className="flex shrink-0 flex-col items-end gap-2 max-sm:items-start">
							<fieldset
								aria-label="Most an agent queues per conversation"
								disabled={!loaded}
								className="flex shrink-0 rounded-md bg-muted p-0.5"
							>
								{AGENT_QUEUE_CAP_PRESETS.map((preset) => {
									const checked =
										!showCustom && value.perConversationCap === preset;
									return (
										<label
											key={preset}
											className={cn(
												"cursor-pointer has-focus-visible:ring-2 has-focus-visible:ring-ring rounded-[calc(var(--radius)-4px)] px-3 py-1 text-muted-foreground text-xs hover:text-foreground",
												checked && "bg-card text-foreground shadow-sm",
											)}
										>
											<input
												type="radio"
												name="agent-queue-cap"
												value={String(preset)}
												checked={checked}
												onChange={() => {
													setCustomOpen(false);
													void update({ perConversationCap: preset });
												}}
												className="sr-only"
											/>
											{preset}
										</label>
									);
								})}
								<label
									className={cn(
										"cursor-pointer has-focus-visible:ring-2 has-focus-visible:ring-ring rounded-[calc(var(--radius)-4px)] px-3 py-1 text-muted-foreground text-xs hover:text-foreground",
										showCustom && "bg-card text-foreground shadow-sm",
									)}
								>
									<input
										type="radio"
										name="agent-queue-cap"
										value="custom"
										checked={showCustom}
										onChange={() => {
											setCustomOpen(true);
											setCustomText(String(value.perConversationCap));
										}}
										className="sr-only"
									/>
									Custom
								</label>
							</fieldset>
							{showCustom && (
								<span className="flex items-center gap-2 text-muted-foreground text-xs">
									<Input
										type="number"
										inputMode="numeric"
										min={1}
										aria-label="Custom per-conversation cap"
										value={customText}
										disabled={!loaded}
										aria-invalid={
											customText === "" ||
											!Number.isInteger(Number(customText)) ||
											Number(customText) < 1
												? true
												: undefined
										}
										onChange={(event) => {
											const raw = event.target.value;
											setCustomText(raw);
											const next = Number(raw);
											if (raw !== "" && Number.isInteger(next) && next >= 1) {
												void update({ perConversationCap: next });
											}
										}}
										onBlur={() =>
											setCustomText(String(value.perConversationCap))
										}
										className="w-20 text-right tabular-nums"
									/>
									tasks
								</span>
							)}
						</div>
					</div>

					<div className="flex items-start gap-6 px-4 py-3.5 max-sm:flex-col max-sm:gap-2 sm:px-5 sm:py-4">
						<div className="min-w-0 flex-1">
							<div className="font-medium text-sm">Quota reserve</div>
							<p className="mt-0.5 text-muted-foreground text-xs">
								A task an agent queued waits while every agent it could go to
								has less than this left in some plan window. Tasks you start or
								queue are never held.
							</p>
						</div>
						<fieldset
							aria-label="Quota reserve"
							disabled={!loaded}
							className="flex shrink-0 rounded-md bg-muted p-0.5"
						>
							{AGENT_QUEUE_RESERVE_PRESETS.map((preset) => {
								const checked = Math.abs(value.quotaReserve - preset) < 1e-9;
								return (
									<label
										key={preset}
										className={cn(
											"cursor-pointer has-focus-visible:ring-2 has-focus-visible:ring-ring rounded-[calc(var(--radius)-4px)] px-3 py-1 text-muted-foreground text-xs hover:text-foreground",
											checked && "bg-card text-foreground shadow-sm",
										)}
									>
										<input
											type="radio"
											name="agent-queue-reserve"
											value={String(preset)}
											checked={checked}
											onChange={() => void update({ quotaReserve: preset })}
											className="sr-only"
										/>
										{Math.round(preset * 100)}%
									</label>
								);
							})}
						</fieldset>
					</div>
					<div className="flex items-start gap-6 px-4 py-3.5 max-sm:flex-col max-sm:gap-2 sm:px-5 sm:py-4">
						<div className="min-w-0 flex-1">
							<div className="font-medium text-sm">Budget per task chain</div>
							<p className="mt-0.5 text-muted-foreground text-xs">
								Tokens the tasks an agent queued may spend, fresh input and
								output, cache reads left out. Past it, the chain’s agents queue
								nothing and ask you before starting work.
							</p>
						</div>
						<fieldset
							aria-label="Budget per task chain"
							disabled={!loaded}
							className="flex shrink-0 rounded-md bg-muted p-0.5"
						>
							{AGENT_QUEUE_BUDGET_PRESETS.map((preset) => {
								const checked = value.chainBudget === preset;
								return (
									<label
										key={preset}
										className={cn(
											"cursor-pointer has-focus-visible:ring-2 has-focus-visible:ring-ring rounded-[calc(var(--radius)-4px)] px-3 py-1 text-muted-foreground text-xs hover:text-foreground",
											checked && "bg-card text-foreground shadow-sm",
										)}
									>
										<input
											type="radio"
											name="agent-queue-budget"
											value={String(preset)}
											checked={checked}
											onChange={() => void update({ chainBudget: preset })}
											className="sr-only"
										/>
										{preset / 1_000_000}M
									</label>
								);
							})}
						</fieldset>
					</div>
				</div>
			</Card>
		</div>
	);
}
