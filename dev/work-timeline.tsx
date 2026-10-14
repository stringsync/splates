import { ChevronRightIcon } from "lucide-react";
import { createContext, type JSX, type ReactNode, use } from "react";
import { CodeDiff } from "#dev/components/assistant-ui/elements/code-diff.tsx";
import {
	field,
	paper,
} from "#dev/components/assistant-ui/elements/surfaces.tsx";
import { cn } from "#dev/lib/utils.ts";
import type { Edit, Tool } from "../conversations";
import { editLines } from "../diff";
import { FileChip } from "./file-chip";
import { Markdown } from "./markdown";
import {
	decided,
	files,
	type Item,
	resource,
	type State,
	span,
	stateOf,
	verb,
} from "./work";

export function TimelineItem({
	item,
	short,
}: {
	item: Item;
	short: (path: string) => string;
}): JSX.Element {
	switch (item.type) {
		case "thought":
			return (
				<Line
					state={item.thinking ? "running" : "done"}
					verb={
						item.thinking
							? "Thinking"
							: item.at === null || item.until === null
								? "Thought"
								: `Thought for ${span(item.at, item.until)}`
					}
				>
					{item.text.trim() !== "" && (
						<p className="whitespace-pre-wrap text-muted-foreground text-xs">
							{item.text.trim()}
						</p>
					)}
				</Line>
			);
		case "command": {
			const tool = item.runs.at(-1) as Tool;
			return (
				<Call
					tool={tool}
					code
					after={item.runs.length > 1 && <span>×{item.runs.length}</span>}
				>
					<div
						className={cn(
							paper,
							"overflow-hidden rounded-md font-mono text-xs leading-relaxed",
						)}
					>
						{tool.command !== null && (
							// A hanging indent, so a long or many-line command lines up
							// after its `$`.
							<pre className="whitespace-pre-wrap py-1.5 pr-2.5 pl-[calc(0.625rem+2ch)] -indent-[2ch]">
								$ {tool.command}
							</pre>
						)}
						{tool.output !== "" ? (
							<section
								aria-label="output"
								className={cn(
									field,
									tool.command !== null && "border-border/60 border-t",
								)}
							>
								{/* Unwrapped, as a terminal shows it, so columns line up. */}
								<pre className="max-h-80 overflow-auto whitespace-pre px-2.5 py-1.5 text-muted-foreground">
									{plain(tool.output)}
								</pre>
							</section>
						) : (
							tool.status !== "pending" &&
							tool.status !== "in_progress" && (
								<p
									className={cn(
										field,
										"px-2.5 py-1.5 font-sans text-muted-foreground",
										tool.command !== null && "border-border/60 border-t",
									)}
								>
									No output
								</p>
							)
						)}
					</div>
				</Call>
			);
		}
		case "edit":
			return (
				<Call tool={item.tool}>
					{item.tool.edits.length > 0 && (
						<Edits edits={item.tool.edits} short={short} />
					)}
				</Call>
			);
		case "subagent":
			return (
				<Call
					tool={item.tool}
					subagent
					after={
						<span>
							· {item.calls.length} tool call
							{item.calls.length === 1 ? "" : "s"}
						</span>
					}
				>
					{item.calls.length > 0 && (
						<ul className="flex flex-col gap-0.5">
							{item.calls.map((call) => (
								<li key={call.id}>
									<Call tool={call} />
								</li>
							))}
						</ul>
					)}
				</Call>
			);
		case "tool":
			return (
				<Call tool={item.tool}>
					{/* A read's output is only the end of the file it read. */}
					{item.tool.kind !== "read" && item.tool.output !== "" && (
						<pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-2 font-mono text-xs">
							{plain(item.tool.output)}
						</pre>
					)}
				</Call>
			);
		case "said":
			return (
				<Markdown
					text={item.text}
					// Set in behind a rule, apart from the calls; its paragraphs and
					// lists, under the div Markdown renders them in, half a line
					// apart in place of their own margins.
					className="border-foreground/20 border-l-2 pl-3 text-foreground text-sm [&>*>*]:my-0! [&>*>*:not(:first-child)]:mt-[0.5lh]!"
				/>
			);
		case "decision":
			return (
				<div className="flex items-center gap-1.5 text-muted-foreground text-sm">
					<span className="shrink-0">{decided(item.decision)}</span>
					<code className="min-w-0 truncate font-mono">{item.label}</code>
				</div>
			);
		default:
			return item satisfies never;
	}
}

/**
 * Whether the turn is still going: once it is over, a call the agent never
 * finished has stopped, not running.
 */
export const Going = createContext(true);

/**
 * A tool call as what it does and what to: "Reading a.ts" while it runs,
 * "Read a.ts" once done.
 */
function Call({
	tool,
	code = false,
	subagent = false,
	after,
	children,
}: {
	tool: Tool;
	/** What it works on is a command, set as code. */
	code?: boolean;
	subagent?: boolean;
	/** Said after what it works on, before how long it took. */
	after?: ReactNode;
	/** What it opens to; a row with none does not open. */
	children?: ReactNode;
}): JSX.Element {
	const state = stateOf(tool, use(Going));
	const what = resource(tool);
	const named = files(tool);
	return (
		<Line
			state={state}
			verb={verb(tool, state, subagent)}
			resource={
				named.length > 0 ? (
					named.map(({ path, lines }) => (
						<FileChip key={path} path={path} lines={lines} />
					))
				) : what === "" ? null : code ? (
					// A size down from the words, where monospace reads as large as they do.
					<code className="min-w-0 truncate font-mono text-muted-foreground text-xs">
						{what}
					</code>
				) : (
					<span className="min-w-0 truncate">{what}</span>
				)
			}
			after={
				<>
					{after}
					<Took tool={tool} />
				</>
			}
		>
			{children}
		</Line>
	);
}

/**
 * A timeline row in words: a verb, set apart in weight, then what it acts
 * on. Its verb shimmers while it goes, the row turns red when it failed,
 * and ends in a caret when it opens to more.
 */
function Line({
	state,
	verb,
	resource,
	after,
	children,
}: {
	state: State;
	verb: string;
	resource?: ReactNode;
	after?: ReactNode;
	children?: ReactNode;
}): JSX.Element {
	const opens = children !== undefined && children !== false;
	const head = (
		<>
			<span className="flex min-w-0 items-center gap-1.5">
				<span
					className={cn(
						"shrink-0 font-medium text-foreground/90",
						state === "running" && "shimmer motion-reduce:animate-none",
					)}
				>
					{verb}
				</span>
				{resource}
			</span>
			{opens && (
				<ChevronRightIcon
					aria-hidden
					className="size-3 shrink-0 text-muted-foreground transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] group-open/row:rotate-90 motion-reduce:transition-none"
				/>
			)}
			{after}
		</>
	);
	const line = cn(
		"flex items-center gap-1.5 text-foreground/80 text-sm",
		state === "failed" && "text-destructive [&_*]:text-destructive",
	);
	if (!opens) {
		return <div className={line}>{head}</div>;
	}
	return (
		<details className="group/row">
			<summary
				className={cn(
					line,
					"cursor-pointer list-none hover:text-foreground [&::-webkit-details-marker]:hidden",
				)}
			>
				{head}
			</summary>
			<div className="mt-1 mb-2 flex flex-col gap-1.5">{children}</div>
		</details>
	);
}

function Took({ tool }: { tool: Tool }): JSX.Element | null {
	if (tool.at === null || tool.until === null) {
		return null;
	}
	return (
		<span className="ml-auto shrink-0 pl-2 text-muted-foreground tabular-nums">
			{span(tool.at, tool.until)}
		</span>
	);
}

/** Each edit as the lines it took out, then the lines it put in. */
function Edits({
	edits,
	short,
}: {
	edits: Edit[];
	short: (path: string) => string;
}): JSX.Element {
	return (
		<section className="flex flex-col gap-2">
			{edits.map((edit, index) => {
				const lines = editLines(edit.old, edit.new);
				return (
					<CodeDiff
						// biome-ignore lint/suspicious/noArrayIndexKey: edits never reorder
						key={index}
						aria-label={`edit to ${edit.path}`}
						filename={short(edit.path)}
						additions={lines.filter((line) => line.kind === "added").length}
						deletions={lines.filter((line) => line.kind === "removed").length}
						lines={lines}
						className="max-h-80 max-w-none overflow-y-auto rounded-md [tab-size:2]"
					/>
				);
			})}
		</section>
	);
}

/** Output without the terminal's color codes. */
function plain(output: string): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: escape codes are what it strips
	return output.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "");
}
