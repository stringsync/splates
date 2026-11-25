import type { ConversationState } from "@splates/server/conversations";
import type { TaskReport } from "@splates/server/plans";
import { isEscalation } from "@splates/server/records/browser";
import { ArchiveIcon } from "lucide-react";
import {
	createContext,
	type JSX,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Button } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";
import { ENDINGS, TONES } from "./card-shell";
import { lastReport } from "./conversation-names";
import { tierOf } from "./event-tier";

/**
 * Putting the conversation away once its last word reports a task that is
 * over: the report card offers it, and the bar above the composer does once
 * the card has scrolled out of sight.
 */
interface ArchiveOffer {
	report: TaskReport;
	archive: () => void;
	/** Says whether any part of the report card is in sight in the thread. */
	sight: (seen: boolean) => void;
}

const ArchiveOfferContext = createContext<ArchiveOffer | null>(null);

export const ArchiveOfferProvider = ArchiveOfferContext.Provider;

/**
 * Archives the conversation, for a card that offers it once the person has
 * done what it asked, such as queue its lane; null while it cannot be.
 */
export const ArchiveConversation = createContext<(() => void) | null>(null);

/**
 * The report to offer archiving the conversation from, and whether the bar
 * offers it: the card stands in for the bar while any of it is in sight.
 */
export function useArchiveOffer(
	report: TaskReport | null,
	archive: () => void,
): { offer: ArchiveOffer | null; barred: boolean } {
	const [seen, setSeen] = useState(false);
	const sight = useCallback((now: boolean) => setSeen(now), []);
	const offer = useMemo(
		() => (report === null ? null : { report, archive, sight }),
		[report, archive, sight],
	);
	return { offer, barred: offer !== null && !seen };
}

/**
 * The report that is the conversation's last word when it says the task is
 * over, and nothing splates shows in the thread came after it, such as
 * another task taken up: null otherwise.
 */
export function endedReport(
	conversation: ConversationState,
): TaskReport | null {
	const report = lastReport(conversation);
	if (report === null || report.ending === "escalated") {
		return null;
	}
	const reply = conversation.messages
		.at(-1)
		?.parts.findLast((part) => part.type === "text" && part.text.trim() !== "");
	const said = reply?.type === "text" ? reply.at : null;
	const movedOn =
		typeof said === "string" &&
		conversation.events.some(
			(event) =>
				event.at > said && (isEscalation(event) || tierOf(event) === "loud"),
		);
	return movedOn ? null : report;
}

/** Whether `report`'s card offers to archive the conversation. */
export function useArchivable(report: TaskReport): boolean {
	const offer = useContext(ArchiveOfferContext);
	return offer !== null && offer.report.source === report.source;
}

/**
 * Archive at the foot of `report`'s card while it is the report the
 * conversation offers to archive from; nothing on any other.
 */
export function CardArchive({
	report,
}: {
	report: TaskReport;
}): JSX.Element | null {
	const offer = useContext(ArchiveOfferContext);
	const footer = useRef<HTMLElement>(null);
	const offered = useArchivable(report);
	const sight = offered ? (offer?.sight ?? null) : null;
	useEffect(() => {
		const element = footer.current?.closest("[data-card]") ?? footer.current;
		if (element === null || sight === null) {
			return;
		}
		const observer = new IntersectionObserver((entries) => {
			const latest = entries.at(-1);
			if (latest !== undefined) {
				sight(latest.isIntersecting);
			}
		});
		observer.observe(element);
		return () => {
			observer.disconnect();
			sight(false);
		};
	}, [sight]);
	if (!offered || offer === null) {
		return null;
	}
	return (
		<footer
			ref={footer}
			className="flex justify-end gap-2 border-t bg-muted/20 px-4 py-2.5"
		>
			<Button
				size="sm"
				variant="outline"
				onClick={offer.archive}
				className="gap-1.5 bg-background"
			>
				<ArchiveIcon data-icon="inline-start" />
				Archive
			</Button>
		</footer>
	);
}

/**
 * A bar above the composer while the conversation's last word is the report
 * of a task that is over and its card is out of sight, offering to put the
 * conversation away. It goes as the conversation carries on.
 */
export function ArchiveBar({ offer }: { offer: ArchiveOffer }): JSX.Element {
	const { report, archive } = offer;
	const { title, Icon, tone } = ENDINGS[report.ending];
	return (
		<section
			aria-label="archive"
			className="flex items-center gap-2 rounded-lg border bg-card px-4 py-2.5 text-sm shadow-xs"
		>
			<Icon className={cn("size-4 shrink-0", TONES[tone].icon)} />
			<span className="min-w-0 truncate">
				{title} <span className="font-mono text-xs">{report.task}</span>
			</span>
			<Button
				size="sm"
				variant="outline"
				onClick={archive}
				className="ml-auto gap-1.5 bg-background"
			>
				<ArchiveIcon data-icon="inline-start" />
				Archive
			</Button>
		</section>
	);
}
