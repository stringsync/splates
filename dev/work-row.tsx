import { makeAssistantDataUI } from "@assistant-ui/react";
import {
	BrainIcon,
	CheckIcon,
	ChevronRightIcon,
	CircleIcon,
	CircleStopIcon,
	FileTextIcon,
	LoaderIcon,
	SearchIcon,
	XIcon,
} from "lucide-react";
import {
	createContext,
	type JSX,
	type ReactNode,
	use,
	useEffect,
	useState,
} from "react";
import { Duration, SystemTimer } from "webappwiz/time";
import { CodeDiff } from "#dev/components/assistant-ui/elements/code-diff.tsx";
import { cn } from "#dev/lib/utils.ts";
import type { Edit, Step, Tool } from "../conversations";
import { editLines } from "../diff";
import { Markdown } from "./markdown";
import {
	doing,
	type Item,
	label,
	shortener,
	span,
	summarize,
	timeline,
	type Work,
	worked,
} from "./work";

/**
 * Renders a `data-work` part: what an agent did before its reply, as one
 * line that says how long and what it is on, with the files it edited, and
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

export function WorkRow({ work }: { work: Work }): JSX.Element {
	const now = useNow(work.running);
	const { edited } = summarize(work);
	const items = timeline(work);
	const short = shortener(
		work.parts.flatMap((part) => (part.type === "tool" ? part.paths : [])),
	);
	const [file, setFile] = useState<string | null>(null);
	// Open while the agent works with nothing said yet, so there is
	// something to watch, and folded once it starts writing its reply.
	const [open, setOpen] = useState(work.running && work.reply === null);
	const replied = work.reply !== null;
	useEffect(() => {
		if (replied) {
			setOpen(false);
		}
	}, [replied]);
	const line = work.running
		? [
				work.at === null ? "Working" : `Working ${span(work.at, now)}`,
				doing(work, now),
			]
				.filter(Boolean)
				.join(" · ")
		: worked(work);
	return (
		<Going value={work.running}>
			<div data-slot="work" className="my-2 flex flex-col gap-1.5 text-sm">
				<details
					open={open}
					onToggle={(event) => setOpen(event.currentTarget.open)}
					className="group/work"
				>
					<summary className="flex cursor-pointer list-none items-center gap-1.5 text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
						<ChevronRightIcon className="size-3.5 shrink-0 transition-transform group-open/work:rotate-90" />
						{work.running && (
							<LoaderIcon className="size-3.5 shrink-0 animate-spin" />
						)}
						<span className="min-w-0 truncate">{line}</span>
					</summary>
					<ol
						aria-label="timeline"
						className="mt-1.5 ml-1.5 flex flex-col gap-1 border-l pl-3"
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
				{edited.length > 0 && (
					<ul aria-label="edited files" className="flex flex-wrap gap-1">
						{edited.map(({ path, count }) => (
							<li key={path}>
								<button
									type="button"
									title={path}
									aria-pressed={file === path}
									onClick={() => setFile(file === path ? null : path)}
									className={cn(
										"flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-xs hover:bg-muted",
										file === path && "bg-muted",
									)}
								>
									<FileTextIcon className="size-3 text-muted-foreground" />
									{short(path)}
									{count > 1 && (
										<span className="text-muted-foreground">×{count}</span>
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
					icon={<Status tool={tool} />}
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
					{tool.command !== null && (
						<pre className="whitespace-pre-wrap break-all font-mono text-xs">
							$ {tool.command}
						</pre>
					)}
					{tool.output !== "" ? (
						<section aria-label="output">
							<pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-2 font-mono text-xs">
								{plain(tool.output)}
							</pre>
						</section>
					) : (
						tool.status !== "pending" &&
						tool.status !== "in_progress" && (
							<p className="text-muted-foreground text-xs">No output</p>
						)
					)}
				</Fold>
			);
		}
		case "edit":
			return (
				<Fold
					icon={<Status tool={item.tool} />}
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
					icon={<Status tool={item.tool} />}
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
					icon={<Status tool={item.tool} />}
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
		default:
			return item satisfies never;
	}
}

/** A timeline row that opens to show more. */
function Fold({
	icon,
	head,
	children,
}: {
	icon: ReactNode;
	head: ReactNode;
	children: ReactNode;
}): JSX.Element {
	return (
		<details className="group/row">
			<summary className="flex cursor-pointer list-none items-center gap-1.5 text-muted-foreground text-xs hover:text-foreground [&::-webkit-details-marker]:hidden">
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
	return <span className="shrink-0">· {span(tool.at, tool.until)}</span>;
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
