import { CircleCheckIcon, WrenchIcon } from "lucide-react";
import type { JSX } from "react";
import { distinctJudges, JudgedBy } from "./eval-judge";
import type { EvalProposal, EvalTurn } from "./eval-proposal";
import { Markdown } from "./markdown";

/**
 * A proposed eval: its title, an example conversation where the person's
 * message gets one good reply, and how it is graded, with its setup above and its checks below. The question it
 * sits in carries the Approve, Edit and Drop.
 */
export function EvalProposalCard({
	proposal,
}: {
	proposal: EvalProposal;
}): JSX.Element {
	const { title, group, message, pass, starts, checks, judge, judgedBy } =
		proposal;
	return (
		<div
			data-slot="eval-proposal"
			className="my-2 flex flex-col gap-4 text-[15px] text-foreground leading-relaxed"
		>
			<div className="flex flex-col gap-1">
				<span className="text-muted-foreground text-xs">Proposed eval</span>
				<span className="font-semibold text-base leading-snug">
					{group !== null && <Coded text={`${group} `} />}
					<Coded text={title} />
				</span>
			</div>
			{starts !== null && <EvalEnvironment text={starts} />}
			<EvalExample message={message} turns={pass} />
			<EvalChecks checks={checks} judge={judge} judgedBy={judgedBy} />
		</div>
	);
}

/** Who speaks: a small caps label above a side of the example. */
function Role({ name }: { name: string }): JSX.Element {
	return (
		<span
			data-slot="example-role"
			className="font-semibold text-[10.5px] text-muted-foreground uppercase tracking-wider"
		>
			{name}
		</span>
	);
}

/**
 * The example conversation in its frame: the person's message, then the
 * sketched good reply. The opened spec on the Evals page draws the same one.
 */
export function EvalExample({
	message,
	turns,
}: {
	message: string;
	turns: EvalTurn[];
}): JSX.Element {
	return (
		<figure
			aria-label="Example conversation"
			className="m-0 flex flex-col gap-4 rounded-2xl border bg-muted/40 p-4"
		>
			<figcaption className="font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
				Example
			</figcaption>
			<div className="flex flex-col items-end gap-1">
				<Role name="You" />
				<div className="w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-muted px-4 py-2.5">
					<Markdown text={message} className="[&_p]:my-0" />
				</div>
			</div>
			{turns.length > 0 && (
				<div className="flex flex-col items-start gap-1.5">
					<Role name="Agent" />
					<Reply turns={turns} />
				</div>
			)}
		</figure>
	);
}

/**
 * A sketched agent reply, in the order it happens: each tool call a light row
 * with a tool icon, outside any bubble, and each stretch of words a bubble.
 */
function Reply({ turns }: { turns: EvalTurn[] }): JSX.Element {
	return (
		<div className="flex flex-col items-start gap-3">
			{turns.map((turn, at) =>
				turn.kind === "tool" ? (
					<ExampleToolCall
						// biome-ignore lint/suspicious/noArrayIndexKey: turns never reorder
						key={at}
						name={turn.name}
						input={turn.input}
						does={turn.does}
					/>
				) : (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: turns never reorder
						key={at}
						className="w-fit max-w-full rounded-2xl rounded-bl-sm border bg-card px-4 py-3"
					>
						<Markdown text={turn.text} className={REPLY_MARKDOWN} />
					</div>
				),
			)}
		</div>
	);
}

/** Reply markdown at the size of the words around it: headings stay lines, not sections. */
const REPLY_MARKDOWN =
	"[&_:is(h1,h2,h3,h4)]:mt-3 [&_:is(h1,h2,h3,h4)]:mb-1 [&_:is(h1,h2,h3,h4)]:text-[15px] [&_:is(h1,h2,h3,h4)]:first:mt-0 [&_p]:my-1 [&_p]:first:mt-0 [&_p]:last:mb-0";

/**
 * A tool call in a sketched reply, drawn like the thread's used-tool line:
 * the tool's name, then what it does in plain words (backticks as inline
 * code), or what it was given when no one wrote that.
 */
export function ExampleToolCall({
	name,
	input,
	does = null,
}: {
	name: string;
	input: string;
	does?: string | null;
}): JSX.Element {
	return (
		<span
			data-slot="example-tool-call"
			className="flex min-w-0 items-start gap-2 px-1 text-muted-foreground text-xs leading-snug"
		>
			<WrenchIcon aria-hidden className="mt-px size-3.5 shrink-0" />
			<span className="flex min-w-0 flex-col gap-0.5">
				<b className="font-semibold">{name}</b>
				{does !== null ? (
					<span className="[overflow-wrap:anywhere]">
						<Coded text={does} />
					</span>
				) : (
					input !== "" && (
						<code className="whitespace-pre-wrap break-words font-mono text-[11.5px]">
							{input}
						</code>
					)
				)}
			</span>
		</span>
	);
}

/** Where the eval starts: its environment, in a box above the example. */
export function EvalEnvironment({ text }: { text: string }): JSX.Element {
	return (
		<section
			aria-label="Environment"
			className="flex flex-col gap-1 rounded-xl border px-3.5 py-2.5 text-[13px] [&_code]:[overflow-wrap:anywhere]"
		>
			<span className="font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
				Environment
			</span>
			<p className="m-0">
				<Coded text={text} />
			</p>
		</section>
	);
}

/**
 * Its checks, always shown in one list: each code check and the judge's
 * question, each tagged so the two kinds read apart.
 */
export function EvalChecks({
	checks,
	judge,
	judgedBy,
}: {
	/** Each code check's one line. */
	checks: string[];
	/** The judge's question, or null when it has no judge. */
	judge: string | null;
	/** Who judges, or null for the default. */
	judgedBy: string | null;
}): JSX.Element | null {
	const total = checks.length + (judge === null ? 0 : 1);
	if (total === 0) {
		return null;
	}
	return (
		<section
			aria-label="Checks"
			className="flex flex-col gap-2.5 border-t pt-3 text-[13px] [&_code]:[overflow-wrap:anywhere]"
		>
			<span className="font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
				Checks · {total}
			</span>
			<ul className="flex flex-col gap-2">
				{checks.map((check) => (
					<li key={check} className="flex items-start gap-2">
						<CircleCheckIcon
							aria-label="check"
							className="mt-[3px] size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
						/>
						<span className="min-w-0 flex-1">
							<Coded text={check} />
						</span>
						<span className="shrink-0 rounded-full border px-2 py-px text-[10.5px] text-muted-foreground">
							Code
						</span>
					</li>
				))}
				{judge !== null && (
					<li className="flex items-start gap-2">
						<CircleCheckIcon
							aria-label="check"
							className="mt-[3px] size-3.5 shrink-0 text-violet-600 dark:text-violet-400"
						/>
						<span className="min-w-0 flex-1">
							<Coded text={judge} />
							<span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-muted-foreground text-xs">
								<JudgedBy
									judges={distinctJudges([judgedBy ?? "claude:sonnet"]).map(
										(judge) => ({
											...judge,
											effort: judge.effort ?? "default",
										}),
									)}
									lead=""
								/>
								<span>· reads the transcript after the run</span>
							</span>
						</span>
						<span className="shrink-0 rounded-full bg-violet-100 px-2 py-px text-[10.5px] text-violet-700 dark:bg-violet-950/60 dark:text-violet-300">
							Judge
						</span>
					</li>
				)}
			</ul>
		</section>
	);
}

/** `text` with its `backticked` stretches as inline code. */
function Coded({ text }: { text: string }): JSX.Element {
	const parts = text.split(/(`[^`]+`)/);
	return (
		<>
			{parts.map((part, at) =>
				part.startsWith("`") && part.endsWith("`") && part.length > 1 ? (
					// biome-ignore lint/suspicious/noArrayIndexKey: parts never reorder
					<code key={at} className="rounded bg-current/10 px-1 text-[0.9em]">
						{part.slice(1, -1)}
					</code>
				) : (
					part
				),
			)}
		</>
	);
}
