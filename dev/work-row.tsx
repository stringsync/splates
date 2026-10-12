import { makeAssistantDataUI } from "@assistant-ui/react";
import {
	BotIcon,
	BrainIcon,
	CheckIcon,
	ChevronRightIcon,
	CircleIcon,
	CircleStopIcon,
	FileTextIcon,
	KeyRoundIcon,
	LoaderIcon,
	PencilIcon,
	SearchIcon,
	SquareTerminalIcon,
	TriangleAlertIcon,
	WrenchIcon,
	XIcon,
} from "lucide-react";
import {
	createContext,
	type JSX,
	type ReactNode,
	use,
	useEffect,
	useRef,
	useState,
} from "react";
import { Duration, SystemTimer } from "webappwiz/time";
import { CodeDiff } from "#dev/components/assistant-ui/elements/code-diff.tsx";
import {
	field,
	paper,
} from "#dev/components/assistant-ui/elements/surfaces.tsx";
import { cn } from "#dev/lib/utils.ts";
import type { Edit, Step, Tool } from "../conversations";
import { editLines } from "../diff";
import { Markdown } from "./markdown";
import {
	decided,
	flagged,
	type Item,
	label,
	relative,
	span,
	split,
	summarize,
	type Trees,
	timeline,
	type Work,
	warning,
	worked,
} from "./work";

/**
 * Renders a `data-work` part: what an agent did before its reply, as one
 * line that says how long it took and, once done, what it added up to, with the files it edited, and
 * the whole timeline a click away.
 */
export const WorkUI = makeAssistantDataUI<{ work: Work }>({
	name: "work",
	render: ({ data }) => <WorkRow work={data.work} />,
});

/**
 * Whether the turn is still going: once it is over, a call the agent never
 * finished has stopped, not running.
 */
const Going = createContext(true);

/** Where the project's trees sit, so a path can show from the top of its own. */
export const TreesContext = createContext<Trees | null>(null);

export function WorkRow({ work }: { work: Work }): JSX.Element {
	const now = useNow(work.running);
	const { edited } = summarize(work);
	const items = timeline(work);
	const trees = use(TreesContext);
	const short = (path: string) => relative(path, trees);
	const [file, setFile] = useState<string | null>(null);
	// Open while the agent works with nothing said yet, so there is
	// something to watch, and folded the first time it starts writing: its
	// words come and go below while it narrates, and a row the person opens
	// again stays open.
	const [open, setOpen] = useState(work.running && work.reply === null);
	const replied = work.reply !== null;
	const folded = useRef(replied);
	useEffect(() => {
		if (replied && !folded.current) {
			folded.current = true;
			setOpen(false);
		}
	}, [replied]);
	return (
		<Going value={work.running}>
			<div data-slot="work" className="my-2 flex flex-col gap-1.5 text-sm">
				<details
					open={open}
					onToggle={(event) => setOpen(event.currentTarget.open)}
					// The timeline slides open and shut with the chevron, where the
					// browser can size to `auto`; elsewhere it opens at once.
					className={cn(
						"group/work [interpolate-size:allow-keywords]",
						"details-content:h-0 details-content:overflow-clip open:details-content:h-auto",
						"details-content:transition-[height,content-visibility] details-content:transition-discrete details-content:duration-200 details-content:ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:details-content:transition-none",
					)}
				>
					<summary className="flex cursor-pointer list-none items-center gap-1.5 text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
						<ChevronRightIcon className="size-3.5 shrink-0 transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] group-open/work:rotate-90 motion-reduce:transition-none" />
						<span
							className={cn(
								"min-w-0 truncate",
								work.running && "shimmer motion-reduce:animate-none",
							)}
						>
							{work.running
								? work.at === null
									? "Working"
									: `Working ${span(work.at, now)}`
								: worked(work)}
						</span>
					</summary>
					<ol
						aria-label="timeline"
						// A line down the left, each call's dot on it.
						className="relative mt-2 ml-1.5 flex flex-col gap-1.5 pl-4 before:absolute before:top-2 before:bottom-2 before:left-[3px] before:w-px before:bg-border"
					>
						{!work.running && work.plan !== null && (
							<li>
								<Plan steps={work.plan} />
							</li>
						)}
						{items.map((item, index) => (
							// The timeline only grows at its end, so an index is stable.
							// biome-ignore lint/suspicious/noArrayIndexKey: as above
							<li key={index}>
								<Row item={item} short={short} />
							</li>
						))}
					</ol>
				</details>
				{work.running && work.plan !== null && <Plan steps={work.plan} />}
				<Flags tools={flagged(work)} short={short} />
				{edited.length > 0 && (
					<ul aria-label="edited files" className="flex flex-wrap gap-1">
						{edited.map(({ path, count }) => (
							<li key={path} className="min-w-0 max-w-full">
								<button
									type="button"
									title={path}
									aria-pressed={file === path}
									onClick={() => setFile(file === path ? null : path)}
									className={cn(
										"flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-xs hover:bg-muted",
										file === path && "bg-muted",
									)}
								>
									<FileTextIcon className="size-3 shrink-0 text-muted-foreground" />
									<Place path={short(path)} />
									{count > 1 && (
										<span className="shrink-0 text-muted-foreground">
											×{count}
										</span>
									)}
								</button>
							</li>
						))}
					</ul>
				)}
				{file !== null && (
					<Edits
						short={short}
						label={`edits to ${file}`}
						edits={work.parts.flatMap((part) =>
							part.type === "tool"
								? part.edits.filter((edit) => edit.path === file)
								: [],
						)}
					/>
				)}
			</div>
		</Going>
	);
}

/**
 * A warning for each command that did to git what it should not have, which
 * opens to the command, and to the main tree's files it changed.
 */
function Flags({
	tools,
	short,
}: {
	tools: Tool[];
	short: (path: string) => string;
}): JSX.Element | null {
	if (tools.length === 0) {
		return null;
	}
	return (
		<ul aria-label="warnings" className="flex flex-col gap-1">
			{tools.map((tool) => {
				const outside = tool.flags.flatMap((flag) =>
					flag.type === "outside" ? flag.paths : [],
				);
				return (
					<li key={tool.id}>
						<details>
							<summary className="flex cursor-pointer list-none items-center gap-1.5 text-warning text-xs [&::-webkit-details-marker]:hidden">
								<TriangleAlertIcon className="size-3.5 shrink-0" />
								<span className="min-w-0 truncate">
									{tool.flags.map(warning).join(" · ")}
								</span>
							</summary>
							<div className="mt-1 mb-2 flex flex-col gap-1.5 pl-5">
								<pre className="whitespace-pre-wrap break-all font-mono text-xs">
									$ {label(tool)}
								</pre>
								{outside.length > 0 && (
									<ul
										aria-label="files changed in the main tree"
										className="flex flex-col gap-0.5 font-mono text-muted-foreground text-xs"
									>
										{outside.map((path) => (
											<li key={path}>{short(path)}</li>
										))}
									</ul>
								)}
							</div>
						</details>
					</li>
				);
			})}
		</ul>
	);
}

/**
 * A file's name, then its directory dimmed: only the directory gives way
 * when they do not fit, so the name always shows.
 */
function Place({ path }: { path: string }): JSX.Element {
	const { name, dir } = split(path);
	return (
		<>
			<span className="max-w-full shrink-0 truncate">{name}</span>
			{dir !== "" && (
				<span className="min-w-0 truncate text-muted-foreground">{dir}</span>
			)}
		</>
	);
}

/** The clock, as epoch ms, moving each second while `running`. */
function useNow(running: boolean): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!running) {
			return;
		}
		const tick = new SystemTimer().setInterval(
			() => setNow(Date.now()),
			Duration.secs(1),
		);
		return () => tick.dispose();
	}, [running]);
	return now;
}

function Row({
	item,
	short,
}: {
	item: Item;
	short: (path: string) => string;
}): JSX.Element {
	switch (item.type) {
		case "text":
			return (
				<Markdown
					text={item.text}
					className="text-muted-foreground text-xs [&_p]:my-0.5"
				/>
			);
		case "thought":
			return (
				<Fold
					icon={<BrainIcon className="size-3" />}
					head={
						item.at === null || item.until === null
							? "Thought"
							: `Thought for ${span(item.at, item.until)}`
					}
				>
					<p className="whitespace-pre-wrap text-muted-foreground text-xs">
						{item.text.trim()}
					</p>
				</Fold>
			);
		case "command": {
			const tool = item.runs.at(-1) as Tool;
			return (
				<Fold
					icon={<Kind tool={tool} icon={<SquareTerminalIcon />} />}
					state={stateOf(tool)}
					head={
						<>
							<code className="min-w-0 truncate font-mono text-xs">
								{label(tool)}
							</code>
							{item.runs.length > 1 && <span>×{item.runs.length}</span>}
							<Took tool={tool} />
						</>
					}
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
				</Fold>
			);
		}
		case "edit":
			return (
				<Fold
					icon={<Kind tool={item.tool} icon={<PencilIcon />} />}
					state={stateOf(item.tool)}
					head={
						<span className="min-w-0 truncate">
							{item.tool.paths.length > 0
								? `Edited ${item.tool.paths.map(short).join(", ")}`
								: item.tool.title}
						</span>
					}
				>
					<Edits edits={item.tool.edits} short={short} />
				</Fold>
			);
		case "reads": {
			const read = item.tools.filter((tool) => tool.kind === "read").length;
			const searched = item.tools.length - read;
			return (
				<Fold
					icon={<SearchIcon className="size-3" />}
					head={[
						read > 0 && `Read ${read} file${read === 1 ? "" : "s"}`,
						searched > 0 &&
							`searched ${searched} time${searched === 1 ? "" : "s"}`,
					]
						.filter(Boolean)
						.join(", ")}
				>
					<Calls tools={item.tools} />
				</Fold>
			);
		}
		case "subagent":
			return (
				<Fold
					icon={<Kind tool={item.tool} icon={<BotIcon />} />}
					state={stateOf(item.tool)}
					head={
						<>
							<span className="min-w-0 truncate">{item.tool.title}</span>
							<span>
								· {item.calls.length} tool call
								{item.calls.length === 1 ? "" : "s"}
							</span>
							<Took tool={item.tool} />
						</>
					}
				>
					<Calls tools={item.calls} />
				</Fold>
			);
		case "tool":
			return (
				<Fold
					icon={<Kind tool={item.tool} icon={<WrenchIcon />} />}
					state={stateOf(item.tool)}
					head={
						<>
							<span className="min-w-0 truncate">{item.tool.title}</span>
							<Took tool={item.tool} />
						</>
					}
				>
					{item.tool.output !== "" && (
						<pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-2 font-mono text-xs">
							{plain(item.tool.output)}
						</pre>
					)}
				</Fold>
			);
		case "decision":
			return (
				<div className="flex items-center gap-1.5 text-muted-foreground text-xs">
					<span className="flex size-3.5 shrink-0 items-center justify-center [&_svg]:size-3">
						<KeyRoundIcon aria-label="permission" />
					</span>
					<span className="shrink-0">{decided(item.decision)}</span>
					<code className="min-w-0 truncate font-mono">{item.label}</code>
				</div>
			);
		default:
			return item satisfies never;
	}
}

/** A timeline row that opens to show more. */
function Fold({
	icon,
	head,
	state = null,
	children,
}: {
	icon: ReactNode;
	head: ReactNode;
	/** How its call went; null for a row that is not one, such as a thought. */
	state?: State | null;
	children: ReactNode;
}): JSX.Element {
	const going = use(Going);
	const shown = state === "running" && !going ? "stopped" : state;
	return (
		<details className="group/row">
			<summary
				className={cn(
					"relative flex cursor-pointer list-none items-center gap-1.5 text-muted-foreground text-xs hover:text-foreground [&::-webkit-details-marker]:hidden",
					shown === "failed" && "text-destructive",
				)}
			>
				{/* Its dot on the timeline's line, colored by how it went. */}
				{shown === null ? (
					<span aria-hidden className={cn(DOT, "bg-muted-foreground/50")} />
				) : (
					<span
						role="img"
						aria-label={SAID[shown]}
						className={cn(
							DOT,
							shown === "done" && "bg-muted-foreground/50",
							shown === "failed" && "bg-destructive",
							shown === "running" && "animate-pulse bg-primary",
							shown === "stopped" && "bg-warning",
						)}
					/>
				)}
				<span className="flex size-3.5 shrink-0 items-center justify-center [&_svg]:size-3">
					{icon}
				</span>
				{head}
			</summary>
			<div className="mt-1 mb-2 flex flex-col gap-1.5 pl-5">{children}</div>
		</details>
	);
}

/** ✓ or ✗ once a call has finished, a spinner until then. */
function Status({ tool }: { tool: Tool }): JSX.Element {
	const going = use(Going);
	switch (tool.status) {
		case "completed":
			return <CheckIcon aria-label="passed" className="text-success" />;
		case "failed":
			return <XIcon aria-label="failed" className="text-destructive" />;
		// Claude leaves a command pending, never in progress, while it runs.
		default:
			return going ? (
				<LoaderIcon aria-label="running" className="animate-spin" />
			) : (
				<CircleStopIcon aria-label="stopped" />
			);
	}
}

function Took({ tool }: { tool: Tool }): JSX.Element | null {
	if (tool.at === null || tool.until === null) {
		return null;
	}
	return (
		<span className="ml-auto shrink-0 pl-2 tabular-nums">
			{span(tool.at, tool.until)}
		</span>
	);
}

/** How a row's call went, for its dot on the timeline. */
type State = "done" | "failed" | "running" | "stopped";

const DOT = "absolute top-1.5 -left-4 size-[7px] rounded-full";

/** Each state as its dot reads aloud. */
const SAID: Record<State, string> = {
	done: "passed",
	failed: "failed",
	running: "running",
	stopped: "stopped",
};

function stateOf(tool: Tool): State {
	return tool.status === "completed"
		? "done"
		: tool.status === "failed"
			? "failed"
			: "running";
}

/**
 * What kind of call a row is, red when it failed, and a spinner while it
 * runs; its dot on the line says how it went.
 */
function Kind({ tool, icon }: { tool: Tool; icon: ReactNode }): JSX.Element {
	const going = use(Going);
	const done = tool.status === "completed" || tool.status === "failed";
	if (!done && going) {
		return <LoaderIcon aria-hidden className="animate-spin" />;
	}
	return (
		<span
			className={cn(
				"flex [&_svg]:size-3",
				tool.status === "failed" && "text-destructive",
			)}
		>
			{icon}
		</span>
	);
}

/** Calls as a plain list, for reads and a subagent's work. */
function Calls({ tools }: { tools: Tool[] }): JSX.Element {
	return (
		<ul className="flex flex-col gap-0.5">
			{tools.map((tool) => (
				<li
					key={tool.id}
					className="flex items-center gap-1.5 text-muted-foreground text-xs [&_svg]:size-3"
				>
					<Status tool={tool} />
					<span className="min-w-0 truncate font-mono">{label(tool)}</span>
				</li>
			))}
		</ul>
	);
}

/** Each edit as the lines it took out, then the lines it put in. */
function Edits({
	edits,
	short,
	label,
}: {
	edits: Edit[];
	short: (path: string) => string;
	label?: string;
}): JSX.Element {
	return (
		<section aria-label={label} className="flex flex-col gap-2">
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

/** The agent's plan as a checklist. */
function Plan({ steps }: { steps: Step[] }): JSX.Element {
	return (
		<ul aria-label="plan" className="flex flex-col gap-0.5 text-xs">
			{steps.map((step, index) => (
				<li
					// biome-ignore lint/suspicious/noArrayIndexKey: a plan is sent whole
					key={index}
					className={cn(
						"flex items-center gap-1.5 text-muted-foreground [&_svg]:size-3",
						step.status === "in_progress" && "text-foreground",
						step.status === "completed" && "line-through",
					)}
				>
					{step.status === "completed" ? (
						<CheckIcon className="size-3 shrink-0" />
					) : step.status === "in_progress" ? (
						<LoaderIcon className="size-3 shrink-0 animate-spin" />
					) : (
						<CircleIcon className="size-3 shrink-0" />
					)}
					{step.text}
				</li>
			))}
		</ul>
	);
}

/** Output without the terminal's color codes. */
function plain(output: string): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: escape codes are what it strips
	return output.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "");
}
