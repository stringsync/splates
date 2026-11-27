import {
	ChevronLeftIcon,
	ChevronRightIcon,
	ChevronsRightIcon,
	SendHorizontalIcon,
} from "lucide-react";
import type { JSX } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { Kbd } from "#web/components/ui/kbd.tsx";
import { cn } from "#web/lib/utils.ts";
import type { CardSendPolicy } from "./card-send-policy";
import { Refusal } from "./refusal";
import { label } from "./shortcuts";

/**
 * The action footer for `QuestionCards`, handling both the phone's pinned
 * paging controls and the desktop send bar, which turns the questions too
 * while it shows them one at a time. Both render the same `CardSendButton`
 * driven by `send` so desktop and mobile sheet share one send policy.
 */
export function QuestionCardsFooter({
	paging,
	stepping = false,
	steppable = false,
	unanswered = null,
	onWhole,
	live,
	page,
	sending,
	planned,
	touch,
	send,
	refusal,
	onTurn,
	onSend,
}: {
	/** Whether it is the phone's sheet, one question a screen. */
	paging: boolean;
	/** Whether the desktop card shows one question at a time. */
	stepping?: boolean;
	/** Whether the desktop card can show one question at a time. */
	steppable?: boolean;
	/** The first other question with no answer, by position, or null. */
	unanswered?: number | null;
	/** Shows every question down the card, or one at a time again. */
	onWhole?: (whole: boolean) => void;
	live: boolean;
	page: number;
	sending: boolean;
	planned: boolean;
	touch: boolean;
	/** Shared policy governing disabled state, pending state, and button label. */
	send: CardSendPolicy;
	refusal: string | null;
	onTurn: (to: number) => void;
	onSend: () => void;
}): JSX.Element | null {
	if (paging) {
		return (
			<footer
				// It stays at the sheet's foot, as a composer does.
				data-pinned
				className="sticky bottom-0 z-10 mt-auto flex flex-col gap-2 border-t bg-background px-4 py-3"
			>
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
						<CardSendButton policy={send} layout="sheet" onSend={onSend} />
					)}
				</div>
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
				<p className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
					{!touch && (
						<>
							<span>
								<Kbd>↵</Kbd> next
							</span>
							<span>
								<Kbd>{label("Mod+Enter")}</Kbd>{" "}
								{send.label === "Answer" ? "answers" : "sends"}
							</span>
						</>
					)}
				</p>
				{steppable && !stepping && (
					<Button size="sm" variant="ghost" onClick={() => onWhole?.(false)}>
						One at a time
					</Button>
				)}
				{stepping && unanswered !== null && (
					<Button
						size="sm"
						variant="ghost"
						className="text-muted-foreground"
						onClick={() => onTurn(unanswered)}
					>
						Next unanswered
						<ChevronsRightIcon data-icon="inline-end" />
					</Button>
				)}
				{stepping && page > 0 && (
					<Button size="sm" variant="outline" onClick={() => onTurn(page - 1)}>
						<ChevronLeftIcon data-icon="inline-start" />
						Back
					</Button>
				)}
				{stepping && !sending ? (
					<Button size="sm" variant="default" onClick={() => onTurn(page + 1)}>
						Next
						<ChevronRightIcon data-icon="inline-end" />
					</Button>
				) : (
					<CardSendButton policy={send} layout="inline" onSend={onSend} />
				)}
			</div>
			<Refusal refusal={refusal} className="text-right" />
		</footer>
	);
}

/**
 * The shared Send/Answer button rendered in both desktop cards and mobile
 * sheets. All disabled, pending, and label logic comes from `policy`, so only
 * layout sizing varies between sheet and inline modes.
 */
export function CardSendButton({
	policy,
	layout,
	onSend,
}: {
	policy: CardSendPolicy;
	layout: "sheet" | "inline";
	onSend: () => void;
}): JSX.Element {
	return (
		<Button
			size={layout === "inline" ? "sm" : "default"}
			variant="default"
			disabled={policy.disabled}
			aria-busy={policy.pending || undefined}
			className={cn(layout === "sheet" && "h-11 flex-1 text-base")}
			onClick={onSend}
		>
			<SendHorizontalIcon data-icon="inline-start" />
			<span aria-live="polite">{policy.label}</span>
		</Button>
	);
}
