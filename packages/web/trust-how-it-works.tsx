import type { TrustBand } from "@splates/server/trust";
import { ClockIcon, LockIcon, type LucideIcon, ShieldIcon } from "lucide-react";
import type { JSX } from "react";
import { Badge } from "#web/components/ui/badge.tsx";
import { Card } from "#web/components/ui/card.tsx";
import { PageSection } from "./page-section";
import { BandBadge } from "./trust-badges";

/**
 * The Trust page's How it works tab: one high-level Overview card showing the
 * three earned autonomy levels and the core rules behind them.
 */
export function TrustHowItWorks(): JSX.Element {
	return (
		<PageSection title="Overview">
			<Card>
				<div className="grid grid-cols-1 gap-2.5 bg-muted/35 p-4 md:grid-cols-3 md:gap-3">
					{STEPS.map((step) => (
						<div
							key={step.band}
							className="flex flex-col gap-2 rounded-[10px] border bg-card p-3"
						>
							<div className="flex items-center justify-between gap-2">
								<BandBadge band={step.band} />
								<Badge variant="secondary">{step.horizon}</Badge>
							</div>
							<p className="text-[13px] text-muted-foreground leading-snug">
								{step.description}
							</p>
						</div>
					))}
				</div>
				<ul className="divide-y divide-border/60 border-t">
					{TAKEAWAYS.map(({ Icon, lead, detail }) => (
						<li
							key={lead}
							className="flex items-start gap-2.5 px-4 py-3 text-[13.5px] leading-snug"
						>
							<Icon
								aria-hidden
								className="mt-0.5 size-4 shrink-0 text-muted-foreground"
							/>
							<div>
								<strong className="font-semibold">{lead}</strong> {detail}
							</div>
						</li>
					))}
				</ul>
			</Card>
		</PageSection>
	);
}

interface LevelStep {
	band: TrustBand;
	horizon: string;
	description: string;
}

const STEPS: readonly LevelStep[] = [
	{
		band: "ask-and-wait",
		horizon: "Start",
		description:
			"Waits for plan approval and question answers before building or merging.",
	},
	{
		band: "ask-and-go",
		horizon: "Days",
		description:
			"Asks questions and posts plans, carrying on with its pick meanwhile.",
	},
	{
		band: "assume",
		horizon: "Weeks",
		description:
			"Makes reversible calls on its own as Assumed lines with an Overturn action.",
	},
];

interface Takeaway {
	Icon: LucideIcon;
	lead: string;
	detail: string;
}

const TAKEAWAYS: readonly Takeaway[] = [
	{
		Icon: ClockIcon,
		lead: "Earned over time:",
		detail:
			"Each chat counts at most once across active days, so one long review never skips ahead.",
	},
	{
		Icon: ShieldIcon,
		lead: "Steady through exploration:",
		detail:
			"Normal mockup and answer tweaks stay light; only reverts, redos, and bad assumptions step a level back.",
	},
	{
		Icon: LockIcon,
		lead: "Hard limits always hold:",
		detail:
			"Only you ship, and spending, deletions, and security always ask; override any model on Models.",
	},
];
