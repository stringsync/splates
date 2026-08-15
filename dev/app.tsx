import { useDisposerEffect, useReactive } from "@webappwiz/react";
import { type JSX, useState } from "react";
import { age } from "../age";
import type { Entry } from "../journal";
import { progress } from "../progress";
import type { Details } from "../show";
import { Feed } from "./feed";
import { Markdown } from "./markdown";

const TABS = ["tasks", "log"] as const;

type Tab = (typeof TABS)[number];

/** A tree in one of these needs fixing rather than driving. */
const BROKEN = new Set(["orphaned", "stray", "unrecorded", "unknown"]);

/** What an escalated task is allowed to shout in, and nothing else here is. */
const NEEDS = "text-amber-600";

export function App(): JSX.Element {
	// One Feed for as long as this component lives. `useReactive` subscribes to
	// the source it saw on its first render, so an instance that got rebuilt
	// would leave the page listening to the one it replaced, showing nothing.
	const [feed] = useState(() => new Feed());
	useDisposerEffect(
		(disposer) => {
			feed.start();
			disposer.defer(() => feed.stop());
		},
		[feed],
	);
	const { snapshot, offline } = useReactive(
		feed,
		(feed) => ({ snapshot: feed.snapshot, offline: feed.offline }),
		["changed"],
	);
	// The tab is the one piece of state this page owns alone, and React keeps it
	// across a refetch, which is what the old page needed a URL hash for.
	const [tab, setTab] = useState<Tab>("tasks");

	return (
		<div className="mx-auto max-w-6xl px-4 py-8 font-mono text-[13px]">
			{/* The same name and tree as the tab, so a window found among many says
			    what it is whichever half of it you are looking at. */}
			<h1 className="mb-4 text-base">
				<b>🌲 arbor</b>
			</h1>
			<nav className="mb-4 flex gap-6 text-xs uppercase tracking-widest">
				{TABS.map((name) => (
					<button
						key={name}
						type="button"
						onClick={() => setTab(name)}
						className={`cursor-pointer ${tab === name ? "" : "opacity-40"}`}
					>
						{name}
					</button>
				))}
			</nav>
			{offline && (
				<p className={`mb-2 ${NEEDS}`}>
					not connected: is <code>arbor dev</code> still running?
				</p>
			)}
			{snapshot === null ? (
				<p className="opacity-60">reading the repo</p>
			) : tab === "tasks" ? (
				<div className="flex gap-8">
					<Contents tasks={snapshot.tasks} />
					{/* Without a minimum of nothing a long worktree path in a card sets
					    the column's width and pushes the sidebar off the screen. */}
					<div className="min-w-0 flex-1">
						<Tasks tasks={snapshot.tasks} />
					</div>
				</div>
			) : (
				<Log entries={snapshot.entries} />
			)}
		</div>
	);
}

function Tasks({ tasks }: { tasks: Details[] }): JSX.Element {
	if (tasks.length === 0) {
		return (
			<p className="opacity-60">
				no tasks: run <Code>arbor add &lt;task&gt;</Code> to start one
			</p>
		);
	}
	return (
		<section aria-label="tasks">
			{tasks.map((task) => (
				<Card key={task.task} task={task} />
			))}
		</section>
	);
}

/**
 * Every task, and how far along it is, in the width the cards do not need. It
 * is the whole run of them at once, which a page of cards taller than the
 * screen otherwise loses. Nothing at all when there are no tasks: the empty
 * state says everything a list of none could.
 */
function Contents({ tasks }: { tasks: Details[] }): JSX.Element | null {
	if (tasks.length === 0) {
		return null;
	}
	return (
		// Narrow enough that it never competes with the cards, and gone entirely
		// once the window cannot spare the column.
		<nav
			aria-label="contents"
			className="sticky top-8 hidden h-fit w-44 shrink-0 sm:block"
		>
			{tasks.map((task) => (
				<a
					key={task.task}
					href={`#${task.task}`}
					className={`my-2 block hover:underline ${
						task.status === "escalated" ? NEEDS : ""
					}`}
				>
					<span className="block truncate">{task.task}</span>
					<Bar plan={task.plan} />
				</a>
			))}
		</nav>
	);
}

function Card({ task }: { task: Details }): JSX.Element {
	const escalated = task.status === "escalated";
	return (
		// An escalated task is waiting on the person reading this page. A yellow
		// accent edge and head are enough to say so; the card itself stays quiet.
		<article
			className={`my-2 rounded border border-current/20 p-3 ${
				escalated ? "border-l-[3px] border-l-amber-600" : ""
			}`}
		>
			{/* The scroll margin is the card's own border and padding plus a line of
			    air, so a heading jumped to from the sidebar arrives with its card
			    around it rather than cropped at the top of the window. */}
			<h2 id={task.task} className={`scroll-mt-8 ${escalated ? NEEDS : ""}`}>
				<a href={`#${task.task}`} className="hover:underline">
					<b>{task.task}</b>
				</a>{" "}
				<Badge status={task.status} /> <Bar plan={task.plan} />{" "}
				<Diff task={task} /> {task.age ?? "?"}
			</h2>
			{/* The reason is the whole point of an escalated card, so it leads rather
			    than joining the run of fields. It runs the full width of the card as
			    a tinted strip, which says "waiting on you" without a second accent
			    edge competing with the card's own. */}
			{task.escalation !== null && (
				<p className={`-mx-3 my-2 bg-amber-600/10 px-3 py-1.5 ${NEEDS}`}>
					{/* The label names what the string is, dimmed like the dt labels. */}
					<b className="mr-1 font-normal opacity-65">reason</b>
					{task.escalation}
				</p>
			)}
			<dl className="my-2 grid grid-cols-[max-content_1fr] gap-x-4">
				<Field name="branch">{task.branch}</Field>
				<Field name="base">{task.base}</Field>
				<Field name="worktree">{task.worktree}</Field>
				<Field name="lease">{task.lease}</Field>
				<Field name="commits">{String(task.ahead ?? "?")}</Field>
			</dl>
			<Plan task={task} />
		</article>
	);
}

function Field({
	name,
	children,
}: {
	name: string;
	children: string;
}): JSX.Element {
	return (
		<>
			<dt className="opacity-60">{name}</dt>
			<dd className="m-0">{children}</dd>
		</>
	);
}

/**
 * Three tones rather than one per status: normal, waiting on a person, and
 * broken. Any more and the colour stops meaning anything.
 */
function Badge({ status }: { status: string }): JSX.Element {
	const tone =
		status === "escalated"
			? `border-amber-600 bg-amber-600/10 ${NEEDS}`
			: BROKEN.has(status)
				? "border-red-600 bg-red-600/18 text-red-600"
				: "border-current/35 opacity-70";
	return (
		<span
			className={`inline-block rounded-full border px-1.5 font-normal text-xs uppercase tracking-wider ${tone}`}
		>
			{status}
		</span>
	);
}

function Diff({ task }: { task: Details }): JSX.Element {
	if (task.added === null || task.removed === null) {
		return <>?</>;
	}
	return (
		<>
			<span className="text-green-600">+{task.added}</span>{" "}
			<span className="text-red-600">-{task.removed}</span>
		</>
	);
}

function Bar({ plan }: { plan: string | null }): JSX.Element | null {
	const counted = plan === null ? null : progress(plan);
	if (counted === null) {
		return null;
	}
	const percent = Math.round((counted.done / counted.total) * 100);
	return (
		<>
			<span
				role="img"
				aria-label={`${counted.done} of ${counted.total} done`}
				className="inline-block h-[0.45rem] w-24 overflow-hidden rounded-full bg-current/18 align-middle"
			>
				<span
					className="block h-full bg-green-600"
					style={{ width: `${percent}%` }}
				/>
			</span>{" "}
			<span className="opacity-60">
				{counted.done}/{counted.total}
			</span>{" "}
		</>
	);
}

function Plan({ task }: { task: Details }): JSX.Element | null {
	if (task.plan === null) {
		// An orphaned tree has no worktree to hold the file, so its absence is not
		// news.
		return task.status === "orphaned" ? null : (
			<p className={NEEDS}>
				no ARBOR.md: whoever picks this up starts from the diff
			</p>
		);
	}
	return (
		<>
			{/* The card's heading already carries the task name, so the document's own
			    title would only say it a second time. */}
			<div className="my-3">
				<p className="opacity-60">ARBOR.md</p>
				<Markdown text={task.plan.replace(/^\s*#\s[^\n]*/, "")} />
			</div>
			{/* The problems sit outside the document: they are what to read it for. */}
			{task.planProblems.map((problem) => (
				<p key={problem} className={NEEDS}>
					{problem}
				</p>
			))}
		</>
	);
}

function Log({ entries }: { entries: Entry[] }): JSX.Element {
	if (entries.length === 0) {
		return <p className="opacity-60">nothing recorded yet</p>;
	}
	return (
		<table aria-label="log" className="border-collapse">
			<tbody>
				{/* Newest first: the page is read to see what just happened. */}
				{entries.toReversed().map((entry) => (
					<tr key={`${entry.at}-${entry.action}-${entry.task ?? ""}`}>
						<Cell>{age(entry.at)}</Cell>
						<Cell>{entry.action}</Cell>
						<Cell>{entry.task ?? "-"}</Cell>
						<td className={entry.reason === null ? "text-green-600" : NEEDS}>
							{entry.reason ?? "ok"}
						</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}

function Cell({ children }: { children: string }): JSX.Element {
	return <td className="py-0.5 pr-6">{children}</td>;
}

function Code({ children }: { children: string }): JSX.Element {
	return <code className="rounded bg-current/10 px-1">{children}</code>;
}
