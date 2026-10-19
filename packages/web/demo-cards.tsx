import { makeAssistantDataUI } from "@assistant-ui/react";
import type { Demo } from "@stringsync/splates-server/plans";
import { ClapperboardIcon, ExternalLinkIcon } from "lucide-react";
import type { JSX } from "react";
import { buttonVariants } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";
import { CardBody, CardShell } from "./card-shell";
import { Markdown } from "./markdown";

/**
 * Renders a `data-demo` part: steps for the person to try. One that ends an escalation, a review or questions shows in their card
 * instead, since what it shows is what they ask about.
 */
export const DemoUI = makeAssistantDataUI<{ demo: Demo }>({
	name: "demo",
	render: ({ data }) => <DemoCard demo={data.demo} />,
});

export function DemoCard({ demo }: { demo: Demo }): JSX.Element {
	return (
		<CardShell
			label={`demo${demo.title === null ? "" : ` ${demo.title}`}`}
			Icon={ClapperboardIcon}
			title={demo.title === null ? "Demo" : `Demo: ${demo.title}`}
			tone="info"
		>
			<DemoSteps demo={demo} />
		</CardShell>
	);
}

/**
 * A demo inside another card: its title over its steps, set apart from what
 * the card says around it by a rule below, unless `className` says otherwise.
 */
export function DemoSection({
	demo,
	className,
}: {
	demo: Demo;
	className?: string;
}): JSX.Element {
	return (
		<section
			aria-label={`demo${demo.title === null ? "" : ` ${demo.title}`}`}
			className={cn("border-b", className)}
		>
			<div className="flex items-center gap-2 px-4 pt-3">
				<ClapperboardIcon className="size-4 text-info" />
				<span className="font-medium text-[13px]">
					{demo.title === null ? "Demo" : `Demo: ${demo.title}`}
				</span>
			</div>
			<DemoSteps demo={demo} />
		</section>
	);
}

/**
 * The first web address a demo's intro names: where it runs. Punctuation that
 * ends the sentence around it is not part of it, as in "Open
 * http://localhost:4410."
 */
function whereIn(intro: string): string | null {
	return (
		/https?:\/\/[^\s)>\]]+/.exec(intro)?.[0].replace(/[.,;:!?'"]+$/, "") ?? null
	);
}

function DemoSteps({ demo }: { demo: Demo }): JSX.Element {
	const where = whereIn(demo.intro);
	return (
		<div className="flex flex-col gap-3 px-4 py-3.5">
			{(demo.intro !== "" || where !== null) && (
				<div className="flex items-start gap-3">
					<CardBody
						text={demo.intro}
						className="min-w-0 flex-1 p-0 text-muted-foreground"
					/>
					{where !== null && (
						<a
							href={where}
							target="_blank"
							rel="noreferrer"
							className={buttonVariants({ variant: "outline", size: "sm" })}
						>
							<ExternalLinkIcon data-icon="inline-start" />
							Open
						</a>
					)}
				</div>
			)}
			{demo.steps.length > 0 && (
				<ol aria-label="steps" className="flex flex-col gap-2.5">
					{demo.steps.map((step) => (
						<li key={step.number} className="flex items-start gap-3">
							<span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-background font-medium text-[11px] text-muted-foreground tabular-nums">
								{step.number}
							</span>
							<div className="flex min-w-0 flex-1 flex-col gap-0.5">
								<Markdown
									text={step.action}
									className="text-sm leading-snug [&_p]:my-0"
								/>
								{step.expect !== "" && (
									<Markdown
										text={step.expect}
										className="text-muted-foreground text-xs leading-relaxed [&_img]:mt-1.5 [&_img]:rounded-lg [&_img]:ring-1 [&_img]:ring-border [&_p:first-child]:mt-0 [&_p:last-child]:mb-0"
									/>
								)}
							</div>
						</li>
					))}
				</ol>
			)}
		</div>
	);
}
