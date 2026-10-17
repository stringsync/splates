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
import { Button } from "#dev/components/ui/button.tsx";
import { cn } from "#dev/lib/utils.ts";
import type { Report } from "../asked";
import { lineCard, touchButton } from "./board";
import { ENDINGS, TONES } from "./card-shell";

/**
 * Putting the conversation away once its last word reports a task that is
 * over: the report card offers it, and the bar above the composer does while
 * the card's button is out of sight.
 */
interface ArchiveOffer {
	report: Report;
	archive: () => void;
	/** Says whether the card's button is in sight in the thread. */
	sight: (seen: boolean) => void;
}

const ArchiveOfferContext = createContext<ArchiveOffer | null>(null);

export const ArchiveOfferProvider = ArchiveOfferContext.Provider;

/** How much of the card's button must show for it to stand in for the bar. */
const IN_VIEW = 0.5;

/**
 * The report to offer archiving the conversation from, and whether the bar
 * offers it: the card's own button stands in for the bar while in sight.
 */
export function useArchiveOffer(
	report: Report | null,
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

/** Whether `report`'s card offers to archive the conversation. */
export function useArchivable(report: Report): boolean {
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
	report: Report;
}): JSX.Element | null {
	const offer = useContext(ArchiveOfferContext);
	const button = useRef<HTMLButtonElement>(null);
	const offered = useArchivable(report);
	const sight = offered ? (offer?.sight ?? null) : null;
	useEffect(() => {
		const element = button.current;
		if (element === null || sight === null) {
			return;
		}
		const observer = new IntersectionObserver(
			(entries) => {
				const latest = entries.at(-1);
				if (latest !== undefined) {
					sight(latest.intersectionRatio >= IN_VIEW);
				}
			},
			{ threshold: IN_VIEW },
		);
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
		<footer className="flex justify-end border-t bg-muted/20 px-4 py-2.5">
			<Button
				ref={button}
				size="sm"
				variant="outline"
				onClick={offer.archive}
				className={cn("gap-1.5 bg-background", touchButton)}
			>
				<ArchiveIcon data-icon="inline-start" />
				Archive
			</Button>
		</footer>
	);
}

/**
 * A bar above the composer while the conversation's last word is the report
 * of a task that is over and its card's Archive is out of sight, offering to
 * put the conversation away: what to do once nothing is left to say. It goes
 * as the conversation carries on.
 */
export function ArchiveBar({ offer }: { offer: ArchiveOffer }): JSX.Element {
	const { report, archive } = offer;
	const { title, Icon, tone } = ENDINGS[report.ending];
	return (
		<section
			aria-label="archive"
			className={cn(
				"flex items-center gap-2 rounded-lg border bg-card pl-3 text-sm shadow-xs",
				lineCard,
			)}
		>
			<Icon className={cn("size-4 shrink-0", TONES[tone].icon)} />
			<span className="min-w-0 truncate">
				{title}{" "}
				<span className="font-mono text-xs">
					{"lanes" in report ? report.lanes.join(", ") : report.task}
				</span>
			</span>
			<Button
				size="sm"
				variant="outline"
				onClick={archive}
				className={cn("ml-auto h-7 gap-1.5 bg-background", touchButton)}
			>
				<ArchiveIcon data-icon="inline-start" />
				Archive
			</Button>
		</section>
	);
}
