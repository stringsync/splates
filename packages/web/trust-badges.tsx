import type { TrustBand } from "@splates/server/trust";
import { FolderIcon } from "lucide-react";
import type { CSSProperties, JSX } from "react";
import { Badge } from "#web/components/ui/badge.tsx";

/** Display label and verdict CSS custom property tone for each trust level. */
export const BAND_META: Record<TrustBand, { label: string; tone: string }> = {
	"ask-and-wait": { label: "Ask & wait", tone: "--warning" },
	"ask-and-go": { label: "Ask & go", tone: "--info" },
	assume: { label: "Assume", tone: "--success" },
};

/** Tinted status badge for an earned or pinned trust level. */
export function BandBadge({ band }: { band: TrustBand }): JSX.Element {
	const { label, tone } = BAND_META[band];
	return (
		<Badge
			variant="outline"
			className="scorecard-verdict"
			style={{ "--verdict": `var(${tone})` } as CSSProperties}
		>
			{label}
		</Badge>
	);
}

/** Bordered monospace folder chip for a declared directory trust scope. */
export function ScopeChip({ path }: { path: string }): JSX.Element {
	return (
		<span
			title={path}
			className="inline-flex h-[22px] max-w-full items-center gap-1 rounded-md border bg-card px-1.5 font-mono text-foreground text-xs"
		>
			<FolderIcon
				aria-hidden
				className="size-3 shrink-0 text-muted-foreground"
			/>
			<span className="min-w-0 truncate">{path}</span>
		</span>
	);
}
