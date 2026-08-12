import { Markdown, useDisposerEffect, useReactive } from "@webappwiz/react";
import { type JSX, useState } from "react";
import { age } from "../age";
import type { Entry } from "../journal";
import { progress } from "../progress";
import type { Details } from "../show";
import { Feed } from "./feed";

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
				<Tasks tasks={snapshot.tasks} />
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
			<p className={escalated ? NEEDS : ""}>
				<b>{task.task}</b> <Badge status={task.status} />{" "}
				<Bar plan={task.plan} /> ahead:{task.ahead ?? "?"} <Diff task={task} />{" "}
				{task.age ?? "?"}
			</p>
			{/* The reason is the whole point of an escalated card, so it leads rather
			    than joining the run of fields. */}
			{task.escalation !== null && (
				<p className="my-2 border-amber-600 border-l-[3px] bg-amber-600/7 px-3 py-1.5">
					<b className={`font-normal ${NEEDS}`}>NEEDS YOU</b> {task.escalation}
				</p>
			)}
			<dl className="my-2 grid grid-cols-[max-content_1fr] gap-x-4">
				<Field name="branch">{task.branch}</Field>
				<Field name="base">{task.base}</Field>
				<Field name="worktree">{task.worktree}</Field>
				<Field name="lease">{task.lease}</Field>
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
