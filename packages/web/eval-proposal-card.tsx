import {
	CircleCheckIcon,
	FileTextIcon,
	FlaskConicalIcon,
	GitBranchIcon,
	LockIcon,
	type LucideIcon,
	ScaleIcon,
	WrenchIcon,
} from "lucide-react";
import type { JSX, ReactNode } from "react";
import { CardShell } from "./card-shell";
import { judgeDisplay } from "./eval-judge";
import type { EvalProposal, EvalScriptTurn, EvalTurn } from "./eval-proposal";
import { Markdown } from "./markdown";

/**
 * The eval card: framed in `CardShell` (`tone="eval"`), with a bold title,
 * optional vertical starting-state rows (`Repo`, `Files`, `State`), an
 * alternating multi-turn chat script, and icon-only checks at the bottom.
 * An eval up for approval carries its question under the checks, as one card.
 */
export function EvalProposalCard({
	proposal,
	label,
	children,
}: {
	proposal: EvalProposal;
	/** What the card is found by, in place of its header's words. */
	label?: string;
	/** The approval asked about it, under its checks. */
	children?: ReactNode;
}): JSX.Element {
	const {
		id,
		title,
		group,
		turns,
		repo,
		files,
		state,
		starts,
		checks,
		judge,
		judgedBy,
	} = proposal;
	const headerTitle = group !== null ? `Eval · ${group}` : "Eval";
	const stageRows = stageRowsOf({ repo, files, state, starts });
	return (
		<div data-slot="eval-proposal">
			<CardShell
				label={label ?? headerTitle}
				Icon={FlaskConicalIcon}
				title={headerTitle}
				tone="eval"
				// Asking, each question marks itself while it has the focus.
				ringed={children === undefined}
				aside={
					id !== null ? (
						<span className="font-mono text-[11.5px] text-muted-foreground">
							{id}
						</span>
					) : undefined
				}
			>
				<div className="px-4 py-3.5 @max-md:px-3 @max-md:py-3">
					<h2 className="m-0 font-bold text-[18px] leading-[1.28] tracking-[-0.015em]">
						<Coded text={title} />
					</h2>
				</div>
				{stageRows.length > 0 && <EvalStage rows={stageRows} />}
				<EvalScript turns={turns} />
				<EvalChecks checks={checks} judge={judge} judgedBy={judgedBy} />
				{children}
			</CardShell>
		</div>
	);
}

interface StageRow {
	label: string;
	Icon: LucideIcon;
	value: string;
}

function stageRowsOf({
	repo,
	files,
	state,
	starts,
}: Pick<EvalProposal, "repo" | "files" | "state" | "starts">): StageRow[] {
	const rows: StageRow[] = [];
	if (repo !== null) {
		rows.push({ label: "Repo", Icon: GitBranchIcon, value: repo });
	}
	if (files !== null) {
		rows.push({ label: "Files", Icon: FileTextIcon, value: files });
	}
	if (state !== null) {
		rows.push({ label: "State", Icon: LockIcon, value: state });
	}
	if (starts !== null) {
		rows.push({
			label: state === null ? "State" : "Starts",
			Icon: LockIcon,
			value: starts,
		});
	}
	return rows;
}

/** Starting state: aligned vertical rows on every width, never columns. */
function EvalStage({ rows }: { rows: StageRow[] }): JSX.Element {
	return (
		<section
			aria-label="Starting state"
			className="flex flex-col gap-1.5 border-y bg-muted/40 px-4 py-2.5 text-[13px] @max-md:px-3 dark:bg-muted/20 [&_code]:[overflow-wrap:anywhere]"
		>
			{rows.map(({ label, Icon, value }) => (
				<div
					key={`${label}:${value}`}
					className="grid grid-cols-[16px_46px_1fr] items-baseline gap-2"
				>
					<span className="flex translate-y-[2px] items-center text-muted-foreground">
						<Icon aria-hidden className="size-[13px] shrink-0" />
					</span>
					<span className="font-semibold text-muted-foreground text-xs">
						{label}
					</span>
					<span className="min-w-0">
						<Coded text={value} />
					</span>
				</div>
			))}
		</section>
	);
}

/** Who speaks: shown only on the first turn of each speaker. */
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
 * The script of alternating user and agent turns, drawn as a normal chat flow
 * with `You` and `Agent` labels only on the first turn of each speaker.
 */
function EvalScript({ turns }: { turns: EvalScriptTurn[] }): JSX.Element {
	let seenUser = false;
	let seenAgent = false;
	return (
		<figure
			aria-label="Example conversation"
			className="m-0 flex flex-col gap-3 px-4 py-3.5 @max-md:px-3"
		>
			{turns.map((turn, index) => {
				if (turn.role === "user") {
					const showLabel = !seenUser;
					seenUser = true;
					return (
						<div
							// biome-ignore lint/suspicious/noArrayIndexKey: turns never reorder
							key={index}
							className="flex flex-col items-end gap-1"
						>
							{showLabel && <Role name="You" />}
							<div className="w-fit max-w-[86%] rounded-2xl rounded-br-sm bg-muted px-3.5 py-2 text-[13.5px]">
								<Markdown text={turn.text} className="[&_p]:my-0" />
							</div>
						</div>
					);
				}
				const showLabel = !seenAgent;
				seenAgent = true;
				return (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: turns never reorder
						key={index}
						className="flex flex-col items-start gap-1.5"
					>
						{showLabel && <Role name="Agent" />}
						<Reply steps={turn.steps} />
					</div>
				);
			})}
		</figure>
	);
}

/**
 * A sketched agent turn, in the order it happens: tool calls as rows above
 * the bubble, and each stretch of words in a bordered card bubble.
 */
function Reply({ steps }: { steps: EvalTurn[] }): JSX.Element {
	return (
		<div className="flex max-w-[92%] flex-col items-start gap-1.5">
			{steps.map((step, at) =>
				step.kind === "tool" ? (
					<ExampleToolCall
						// biome-ignore lint/suspicious/noArrayIndexKey: steps never reorder
						key={at}
						name={step.name}
						input={step.input}
						does={step.does}
					/>
				) : (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: steps never reorder
						key={at}
						className="w-fit max-w-full rounded-2xl rounded-bl-sm border bg-card px-3.5 py-2 text-[13.5px]"
					>
						<Markdown text={step.text} className={REPLY_MARKDOWN} />
					</div>
				),
			)}
		</div>
	);
}

/** Reply markdown at the size of the words around it: headings stay lines, not sections. */
const REPLY_MARKDOWN =
	"[&_:is(h1,h2,h3,h4)]:mt-3 [&_:is(h1,h2,h3,h4)]:mb-1 [&_:is(h1,h2,h3,h4)]:text-[13.5px] [&_:is(h1,h2,h3,h4)]:first:mt-0 [&_p]:my-1 [&_p]:first:mt-0 [&_p]:last:mb-0";

/**
 * A tool call row: wrench icon, bold tool name, and plain-English `does`
 * (or inline code input when no `does` was written).
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
			className="flex min-w-0 items-start gap-1.5 px-0.5 text-muted-foreground text-xs leading-snug"
		>
			<WrenchIcon aria-hidden className="mt-0.5 size-[13px] shrink-0" />
			<span className="min-w-0 [overflow-wrap:anywhere]">
				<b className="font-semibold text-foreground">{name}</b>
				{does !== null ? (
					<>
						{" "}
						<Coded text={does} />
					</>
				) : (
					input !== "" && (
						<>
							{" "}
							<code className="rounded bg-current/10 px-1 font-mono text-[0.86em]">
								{input}
							</code>
						</>
					)
				)}
			</span>
		</span>
	);
}

/**
 * Checks separated by an inset hairline (`rule-t`), with no heading and no
 * right-hand chips: green `CircleCheck` for code checks, violet `Scale` +
 * bold `<Judge>:` for judge checks (defaulting to `Jev`).
 */
export function EvalChecks({
	checks,
	judge,
	judgedBy,
}: {
	checks: string[];
	judge: string | null;
	judgedBy: string | null;
}): JSX.Element | null {
	if (checks.length === 0 && judge === null) {
		return null;
	}
	const judgeName = judgeDisplay(judgedBy)?.name ?? "Jev";
	return (
		<section
			aria-label="Checks"
			className="rule-t flex flex-col gap-2 px-4 pt-3 pb-3.5 text-[13px] @max-md:px-3 [&_code]:[overflow-wrap:anywhere]"
		>
			<ul className="m-0 flex list-none flex-col gap-2 p-0">
				{checks.map((check) => (
					<li key={check} className="flex items-start gap-2.5">
						<CircleCheckIcon
							aria-label="check"
							className="mt-[3px] size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
						/>
						<span className="min-w-0 flex-1">
							<Coded text={check} />
						</span>
					</li>
				))}
				{judge !== null && (
					<li className="flex items-start gap-2.5">
						<ScaleIcon
							aria-label="judge"
							className="mt-[3px] size-3.5 shrink-0 text-violet-600 dark:text-violet-400"
						/>
						<span className="min-w-0 flex-1">
							<b className="font-semibold">{judgeName}:</b>{" "}
							<Coded text={judge} />
						</span>
					</li>
				)}
			</ul>
		</section>
	);
}

/** `text` with its `backticked` stretches as inline code. */
export function Coded({ text }: { text: string }): JSX.Element {
	const parts = text.split(/(`[^`]+`)/);
	return (
		<>
			{parts.map((part, at) =>
				part.startsWith("`") && part.endsWith("`") && part.length > 1 ? (
					<code
						// biome-ignore lint/suspicious/noArrayIndexKey: parts never reorder
						key={at}
						className="rounded bg-current/10 px-1 py-px font-mono text-[0.86em]"
					>
						{part.slice(1, -1)}
					</code>
				) : (
					part
				),
			)}
		</>
	);
}
