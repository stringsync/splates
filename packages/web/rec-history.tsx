import { age } from "@splates/server/age";
import type {
	RecSessionSummary,
	RecSessions,
} from "@splates/server/rec/browser";
import { ChevronRightIcon, SearchIcon } from "lucide-react";
import { type JSX, useEffect, useState } from "react";
import { Input } from "#web/components/ui/input.tsx";
import { Skeleton } from "#web/components/ui/skeleton.tsx";
import { recSessions, searchRecSessions } from "./api";
import { bytesText, clock } from "./rec-format";

const WEEK = 7 * 24 * 60 * 60 * 1000;

/**
 * Every saved session, newest first, under This week and Earlier; the search
 * narrows them by name or by what was said, and each row opens its session.
 */
export function RecHistory(): JSX.Element {
	const [store, setStore] = useState<RecSessions | null>(null);
	const [failed, setFailed] = useState(false);
	const [query, setQuery] = useState("");
	const [matches, setMatches] = useState<Set<string> | null>(null);
	useEffect(() => {
		recSessions().then(setStore, () => setFailed(true));
	}, []);
	useEffect(() => {
		if (query.trim() === "") {
			setMatches(null);
			return;
		}
		let live = true;
		const timer = setTimeout(() => {
			searchRecSessions(query).then(
				(found) => live && setMatches(new Set(found.map((each) => each.name))),
				() => live && setMatches(new Set()),
			);
		}, 200);
		return () => {
			live = false;
			clearTimeout(timer);
		};
	}, [query]);
	const shown = (store?.sessions ?? []).filter(
		(each) => matches === null || matches.has(each.name),
	);
	const recent = shown.filter((each) => Date.now() - each.startedAt < WEEK);
	const earlier = shown.filter((each) => !recent.includes(each));
	return (
		<section aria-label="history" className="flex flex-col gap-4">
			<div className="relative">
				<SearchIcon
					aria-hidden
					className="absolute top-2.5 left-2.5 size-4 text-muted-foreground"
				/>
				<Input
					aria-label="Search sessions"
					placeholder="Search names and what was said"
					className="pl-8"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
				/>
			</div>
			{store === null ? (
				failed ? (
					<p className="text-muted-foreground text-sm">
						Rec's sessions could not be read. Is rec installed?
					</p>
				) : (
					<Skeleton className="h-5 w-full animate-pulse" />
				)
			) : shown.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					{store.sessions.length === 0
						? "No sessions yet."
						: "No session matches."}
				</p>
			) : (
				<>
					<Group title="This week" sessions={recent} />
					<Group title="Earlier" sessions={earlier} />
				</>
			)}
			{store !== null && <Usage store={store} />}
		</section>
	);
}

function Usage({ store }: { store: RecSessions }): JSX.Element {
	const share = Math.min(1, store.totalSize / store.limit);
	return (
		<div className="flex flex-col gap-1 text-xs">
			<div
				role="progressbar"
				aria-label="Storage used"
				aria-valuemin={0}
				aria-valuemax={store.limit}
				aria-valuenow={store.totalSize}
				className="h-1.5 overflow-hidden rounded-full bg-muted"
			>
				<div
					className="h-full bg-primary"
					style={{ width: `${share * 100}%` }}
				/>
			</div>
			<span>
				{bytesText(store.totalSize)} of {bytesText(store.limit)}
			</span>
			<span className="text-muted-foreground">{store.policy}</span>
		</div>
	);
}

function Group({
	title,
	sessions,
}: {
	title: string;
	sessions: RecSessionSummary[];
}): JSX.Element | null {
	if (sessions.length === 0) {
		return null;
	}
	return (
		<div className="flex flex-col gap-1">
			<h2 className="font-medium text-muted-foreground text-xs">{title}</h2>
			<ul className="flex flex-col divide-y rounded-lg border bg-card px-3">
				{sessions.map((each) => (
					<li key={each.name} aria-label={each.name} className="py-2">
						<a
							href={`#rec/${encodeURIComponent(each.name)}`}
							className="flex min-w-0 flex-col gap-0.5 text-sm"
						>
							<span className="flex min-w-0 items-center gap-2">
								<span className="truncate font-medium font-mono">
									{each.name}
								</span>
								<span className="shrink-0 text-muted-foreground text-xs">
									{each.moments} {each.moments === 1 ? "moment" : "moments"} ·{" "}
									{clock(each.length)} · {bytesText(each.size)}
								</span>
								<time
									dateTime={new Date(each.startedAt).toISOString()}
									className="ml-auto shrink-0 text-muted-foreground"
								>
									{age(new Date(each.startedAt).toISOString())} ago
								</time>
								<ChevronRightIcon aria-hidden className="size-3.5 shrink-0" />
							</span>
							{each.topSaid !== undefined && (
								<span className="truncate text-muted-foreground text-xs">
									“{each.topSaid}”
								</span>
							)}
						</a>
					</li>
				))}
			</ul>
		</div>
	);
}
