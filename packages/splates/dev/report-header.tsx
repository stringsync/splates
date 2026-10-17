import { CodeIcon } from "lucide-react";
import type { JSX } from "react";
import { Button } from "#dev/components/ui/button.tsx";
import { cn } from "#dev/lib/utils.ts";
import { touchArea } from "./board";
import { useNow } from "./hooks/use-now";
import { span } from "./work";
import type { ReportTiming } from "./working-report-time";

/** The report header's clock and source toggle. */
export function ReportAside({
	timing,
	showing,
	toggle,
}: {
	timing: ReportTiming | undefined;
	showing: boolean;
	toggle: () => void;
}): JSX.Element {
	return (
		<span className="inline-flex items-center gap-2">
			{timing !== undefined && <WorkingElapsed timing={timing} />}
			<Button
				size="icon-xs"
				variant="ghost"
				aria-label="Show source"
				aria-pressed={showing}
				title={showing ? "Hide source" : "Show source"}
				onClick={toggle}
				className={cn(
					"relative",
					touchArea,
					showing && "bg-accent text-accent-foreground",
				)}
			>
				<CodeIcon />
			</Button>
		</span>
	);
}

/** Live until later agent words replace the working report. */
function WorkingElapsed({ timing }: { timing: ReportTiming }): JSX.Element {
	const now = useNow(timing.until === null);
	return (
		<span
			role="timer"
			aria-label="Elapsed time"
			title="Elapsed time"
			className="shrink-0 whitespace-nowrap text-muted-foreground text-xs tabular-nums"
		>
			{span(timing.at, timing.until ?? now)}
		</span>
	);
}
