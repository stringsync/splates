import type { Question } from "@splates/server/plans";
import {
	BanIcon,
	CheckIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	EllipsisIcon,
	FileTextIcon,
	SendHorizontalIcon,
} from "lucide-react";
import type { JSX } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#web/components/ui/dropdown-menu.tsx";
import { Kbd } from "#web/components/ui/kbd.tsx";
import { cn } from "#web/lib/utils.ts";
import { touchItems } from "./board";
import { Refusal } from "./refusal";
import { label } from "./shortcuts";

/** A plan card's final approval question and its choice keys. */
export interface PlanDecision {
	asked: Question;
	approve: string;
	reject: string | null;
	full: string | null;
}

/**
 * The plan's approval when the card ends with one the footer can decide: the
 * question, its approving and rejecting choice keys, and the one asking for a
 * full plan.
 */
export function decisionOf(questions: Question[]): PlanDecision | null {
	const asked = questions.at(-1);
	if (asked === undefined || asked.plan === undefined || asked.pick !== "one") {
		return null;
	}
	const approve = asked.choices.find((choice) => /^yes\b/i.test(choice.text));
	if (approve === undefined) {
		return null;
	}
	const reject = asked.choices.find((choice) => /^no\b/i.test(choice.text));
	const full = asked.choices.find((choice) =>
		/\bfull plan\b/i.test(choice.text),
	);
	return {
		asked,
		approve: approve.key,
		reject: reject?.key ?? null,
		full: full?.key ?? null,
	};
}

/**
 * The action footer for `QuestionCards`, handling both the phone's pinned
 * paging controls and the desktop send / approve bar.
 */
export function QuestionCardsFooter({
	paging,
	live,
	page,
	sending,
	decidingHere,
	decision,
	sendingFeedback,
	planned,
	touch,
	answering,
	empty,
	taking,
	refusal,
	onTurn,
	onSend,
	onDecide,
}: {
	paging: boolean;
	live: boolean;
	page: number;
	sending: boolean;
	decidingHere: boolean;
	decision: PlanDecision | null;
	/** Whether the plan's note box has words, attachments, or an active take. */
	sendingFeedback: boolean;
	planned: boolean;
	touch: boolean;
	answering: boolean;
	empty: boolean;
	taking: boolean;
	refusal: string | null;
	onTurn: (to: number) => void;
	onSend: () => void;
	onDecide: (pick: "approve" | "reject" | "full" | "send") => void;
}): JSX.Element | null {
	if (paging) {
		return (
			<footer
				// It stays at the sheet's foot, as a composer does.
				data-pinned
				className="sticky bottom-0 z-10 mt-auto flex flex-col gap-2 border-t bg-background px-4 py-3"
			>
				{decidingHere && decision !== null ? (
					decision.reject !== null || decision.full !== null || page > 0 ? (
						// Approve stays on the right under a right thumb; Reject, Request
						// full plan and Back live in the ellipsis menu on the left.
						<div className="flex items-center gap-2">
							<DropdownMenu>
								<DropdownMenuTrigger
									render={
										<Button
											variant="outline"
											className="size-11"
											aria-label="More actions"
										/>
									}
								>
									<EllipsisIcon />
								</DropdownMenuTrigger>
								<DropdownMenuContent
									align="start"
									side="top"
									className={`w-60 ${touchItems}`}
								>
									{decision.reject !== null && (
										<DropdownMenuItem onClick={() => onDecide("reject")}>
											<BanIcon />
											Reject
										</DropdownMenuItem>
									)}
									{decision.full !== null && (
										<DropdownMenuItem onClick={() => onDecide("full")}>
											<FileTextIcon />
											Request full plan
										</DropdownMenuItem>
									)}
									{page > 0 && (
										<DropdownMenuItem onClick={() => onTurn(page - 1)}>
											<ChevronLeftIcon />
											Back
										</DropdownMenuItem>
									)}
								</DropdownMenuContent>
							</DropdownMenu>
							<DecisionButton
								sending={sendingFeedback}
								onApprove={() => onDecide("approve")}
								onSend={() => onDecide("send")}
								className="h-11 flex-1 text-base"
							/>
						</div>
					) : (
						<DecisionButton
							sending={sendingFeedback}
							onApprove={() => onDecide("approve")}
							onSend={() => onDecide("send")}
							className="h-11 w-full text-base"
						/>
					)
				) : (
					<div className="flex items-center gap-3">
						{page > 0 && (
							<Button
								variant="outline"
								className="h-11 px-4 text-base"
								onClick={() => onTurn(page - 1)}
							>
								<ChevronLeftIcon data-icon="inline-start" />
								Back
							</Button>
						)}
						{!sending ? (
							<Button
								variant="outline"
								className="h-11 flex-1 border-border bg-white text-base text-black hover:bg-white/90 hover:text-black active:bg-white/80 active:text-black dark:border-border dark:bg-white dark:hover:bg-white/90 dark:active:bg-white/80"
								onClick={() => onTurn(page + 1)}
							>
								Next
								<ChevronRightIcon data-icon="inline-end" />
							</Button>
						) : (
							<Button
								variant="default"
								className="h-11 flex-1 bg-black text-base text-white hover:bg-black/90 active:bg-black/80"
								onClick={onSend}
							>
								<SendHorizontalIcon data-icon="inline-start" />
								Send
							</Button>
						)}
					</div>
				)}
				<Refusal refusal={refusal} className="text-right" />
			</footer>
		);
	}
	if (!live) {
		return null;
	}
	return (
		<footer
			className={cn(
				"flex flex-col gap-2.5 border-t py-3",
				planned ? "bg-muted/25 px-5 @max-md:px-3.5" : "bg-muted/20 px-4",
			)}
		>
			<div className="flex items-center gap-3">
				{decision === null ? (
					<>
						<p className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
							{!touch && (
								<>
									<span>
										<Kbd>↵</Kbd> next
									</span>
									<span>
										<Kbd>{label("Mod+Enter")}</Kbd>{" "}
										{answering ? "answers" : "sends"}
									</span>
								</>
							)}
						</p>
						<Button
							size="sm"
							variant="default"
							disabled={empty && !taking}
							onClick={onSend}
						>
							<SendHorizontalIcon data-icon="inline-start" />
							<span aria-live="polite">{answering ? "Answer" : "Send"}</span>
						</Button>
					</>
				) : (
					<>
						<div className="flex flex-1 items-center">
							{decision.full !== null && (
								<Button
									size="sm"
									variant="ghost"
									className="text-muted-foreground"
									onClick={() => onDecide("full")}
								>
									<FileTextIcon data-icon="inline-start" />
									Request full plan
								</Button>
							)}
						</div>
						<div className="flex items-center gap-2">
							{decision.reject !== null && (
								<Button
									size="sm"
									variant="outline"
									onClick={() => onDecide("reject")}
								>
									<BanIcon
										data-icon="inline-start"
										className="text-muted-foreground"
									/>
									Reject
								</Button>
							)}
							<DecisionButton
								sending={sendingFeedback}
								onApprove={() => onDecide("approve")}
								onSend={() => onDecide("send")}
								size="sm"
							/>
						</div>
					</>
				)}
			</div>
			<Refusal refusal={refusal} className="text-right" />
		</footer>
	);
}

/**
 * Primary CTA for plan cards: approves when the note box is empty, and switches
 * to Send without implicit approval once the user types, attaches, or dictates.
 */
function DecisionButton({
	sending,
	onApprove,
	onSend,
	className,
	size,
}: {
	sending: boolean;
	onApprove: () => void;
	onSend: () => void;
	className?: string;
	size?: "sm";
}): JSX.Element {
	if (sending) {
		return (
			<Button
				variant="default"
				size={size}
				onClick={onSend}
				className={className}
			>
				<SendHorizontalIcon data-icon="inline-start" />
				Send
			</Button>
		);
	}
	return (
		<Button
			variant="default"
			size={size}
			onClick={onApprove}
			className={cn(
				"bg-success text-white hover:bg-success/90 active:bg-success/80",
				className,
			)}
		>
			<CheckIcon data-icon="inline-start" />
			Approve
		</Button>
	);
}
