import {
	ChevronLeftIcon,
	ChevronRightIcon,
	ChevronsRightIcon,
	SendHorizontalIcon,
} from "lucide-react";
import type { JSX } from "react";
import { Kbd } from "#web/components/ui/kbd.tsx";
import { CardFooter, type CardFooterAction } from "./card-footer";
import type { CardSendPolicy } from "./card-send-policy";
import { label } from "./shortcuts";

/**
 * The action footer for `QuestionCards`, delegating both the phone's pinned
 * paging controls and the desktop send bar to `CardFooter`.
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
	planned?: boolean;
	touch: boolean;
	/** Shared policy governing disabled state, pending state, and button label. */
	send: CardSendPolicy;
	refusal: string | null;
	onTurn: (to: number) => void;
	onSend: () => void;
}): JSX.Element | null {
	if (paging) {
		const actions: CardFooterAction[] = [
			...(page > 0
				? [
						{
							label: "Back",
							Icon: ChevronLeftIcon,
							onClick: () => onTurn(page - 1),
						},
					]
				: []),
			!sending
				? {
						label: "Next",
						Icon: ChevronRightIcon,
						primary: true,
						onClick: () => onTurn(page + 1),
					}
				: {
						label: send.label,
						Icon: SendHorizontalIcon,
						primary: true,
						disabled: send.disabled,
						busy: send.pending,
						onClick: onSend,
					},
		];
		return <CardFooter actions={actions} refusal={refusal} />;
	}
	if (!live) {
		return null;
	}
	const actions: CardFooterAction[] = [
		...(steppable && !stepping
			? [
					{
						label: "One at a time",
						onClick: () => onWhole?.(false),
					},
				]
			: []),
		...(stepping && unanswered !== null
			? [
					{
						label: "Next unanswered",
						Icon: ChevronsRightIcon,
						onClick: () => onTurn(unanswered),
					},
				]
			: []),
		...(stepping && page > 0
			? [
					{
						label: "Back",
						Icon: ChevronLeftIcon,
						onClick: () => onTurn(page - 1),
					},
				]
			: []),
		stepping && !sending
			? {
					label: "Next",
					Icon: ChevronRightIcon,
					primary: true,
					onClick: () => onTurn(page + 1),
				}
			: {
					label: send.label,
					Icon: SendHorizontalIcon,
					primary: true,
					disabled: send.disabled,
					busy: send.pending,
					onClick: onSend,
				},
	];
	return (
		<CardFooter
			note={
				!touch ? (
					<>
						<span>
							<Kbd>↵</Kbd> next
						</span>
						<span>
							<Kbd>{label("Mod+Enter")}</Kbd>{" "}
							{send.label === "Answer" ? "answers" : "sends"}
						</span>
					</>
				) : undefined
			}
			actions={actions}
			refusal={refusal}
		/>
	);
}
