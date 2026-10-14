import { makeAssistantDataUI, useAuiState } from "@assistant-ui/react";
import { CheckIcon, ClapperboardIcon, ExternalLinkIcon } from "lucide-react";
import { type JSX, useContext, useState } from "react";
import { buttonVariants } from "#dev/components/ui/button.tsx";
import { cn } from "#dev/lib/utils.ts";
import type { Demo } from "../demo";
import { CardBody, CardShell } from "./card-shell";
import { Markdown } from "./markdown";
import { ReplyContext } from "./question-cards";

/**
 * Renders a `data-demo` part: steps for the person to try, ticked off as they
 * go. One that ends an escalation, a review or questions shows in their card
 * instead, since what it shows is what they ask about.
 */
export const DemoUI = makeAssistantDataUI<{ demo: Demo }>({
	name: "demo",
	render: ({ data }) => <MessageDemo demo={data.demo} />,
});

function MessageDemo({ demo }: { demo: Demo }): JSX.Element {
	const message = useAuiState((state) => state.message.id);
	return <DemoCard demo={demo} kept={`demo:${message}`} />;
}

export function DemoCard({
	demo,
	kept = null,
}: {
	demo: Demo;
	/** The name its ticks are kept under in the conversation's drafts. */
	kept?: string | null;
}): JSX.Element {
	const ticks = useTicks(kept);
	const done = demo.steps.filter((step) =>
		ticks.done.includes(step.number),
	).length;
	return (
		<CardShell
			label={`demo${demo.title === null ? "" : ` ${demo.title}`}`}
			Icon={ClapperboardIcon}
			title={demo.title === null ? "Demo" : `Demo: ${demo.title}`}
			tone="info"
			aside={
				demo.steps.length === 0 ? undefined : (
					<Progress done={done} of={demo.steps.length} />
				)
			}
		>
			<DemoSteps demo={demo} ticks={ticks} />
		</CardShell>
	);
}

/**
 * A demo inside another card: its title over its steps, set apart from what
 * the card says around it.
 */
export function DemoSection({
	demo,
	kept,
}: {
	demo: Demo;
	kept: string | null;
}): JSX.Element {
	const ticks = useTicks(kept);
	const done = demo.steps.filter((step) =>
		ticks.done.includes(step.number),
	).length;
	return (
		<section
			aria-label={`demo${demo.title === null ? "" : ` ${demo.title}`}`}
			className="border-b"
		>
			<div className="flex items-center gap-2 px-4 pt-3">
				<ClapperboardIcon className="size-4 text-info" />
				<span className="font-medium text-[13px]">
					{demo.title === null ? "Demo" : `Demo: ${demo.title}`}
				</span>
				{demo.steps.length > 0 && (
					<span className="ml-auto">
						<Progress done={done} of={demo.steps.length} />
					</span>
				)}
			</div>
			<DemoSteps demo={demo} ticks={ticks} />
		</section>
	);
}

/** Which steps are ticked, kept so leaving and coming back loses none. */
interface Ticks {
	done: string[];
	/** Null where nothing can be ticked, as outside a conversation. */
	toggle: ((number: string) => void) | null;
}

function useTicks(name: string | null): Ticks {
	const drafts = useContext(ReplyContext)?.drafts ?? null;
	const [done, setDone] = useState<string[]>(() =>
		name === null || drafts === null
			? []
			: drafts.read(name).split(",").filter(Boolean),
	);
	if (drafts === null) {
		return { done, toggle: null };
	}
	return {
		done,
		toggle: (number) => {
			const next = done.includes(number)
				? done.filter((each) => each !== number)
				: [...done, number];
			setDone(next);
			if (name !== null) {
				drafts.write(name, next.join(","));
			}
		},
	};
}

function Progress({ done, of }: { done: number; of: number }): JSX.Element {
	return (
		<span className="flex items-center gap-2">
			<span className="text-muted-foreground text-xs tabular-nums">
				{done} of {of} tried
			</span>
			<span
				aria-hidden
				className="block h-1 w-14 overflow-hidden rounded-full bg-border"
			>
				<span
					className="block h-full rounded-full bg-success transition-[width] duration-300 ease-out"
					style={{ width: `${(done / of) * 100}%` }}
				/>
			</span>
		</span>
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

function DemoSteps({ demo, ticks }: { demo: Demo; ticks: Ticks }): JSX.Element {
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
					{demo.steps.map((step) => {
						const done = ticks.done.includes(step.number);
						const toggle = ticks.toggle;
						return (
							<li key={step.number} className="flex items-start gap-3">
								<label
									className={cn(
										"mt-px flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full border font-medium text-[11px] tabular-nums transition-colors has-[:disabled]:cursor-default has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/40",
										done
											? "border-success bg-success text-white"
											: "border-border bg-background text-muted-foreground hover:border-ring",
									)}
								>
									<input
										type="checkbox"
										checked={done}
										aria-label={`Step ${step.number} tried`}
										disabled={toggle === null}
										onChange={() => toggle?.(step.number)}
										className="sr-only"
									/>
									{done ? (
										<CheckIcon className="size-3" strokeWidth={3} />
									) : (
										step.number
									)}
								</label>
								<div className="flex min-w-0 flex-1 flex-col gap-0.5">
									<Markdown
										text={step.action}
										className={cn(
											"text-sm leading-snug transition-opacity [&_p]:my-0",
											done && "opacity-60",
										)}
									/>
									{step.expect !== "" && (
										<Markdown
											text={step.expect}
											className="text-muted-foreground text-xs leading-relaxed [&_img]:mt-1.5 [&_img]:rounded-lg [&_img]:ring-1 [&_img]:ring-border [&_p:first-child]:mt-0 [&_p:last-child]:mb-0"
										/>
									)}
								</div>
							</li>
						);
					})}
				</ol>
			)}
		</div>
	);
}
