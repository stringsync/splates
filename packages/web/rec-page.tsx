import type { RecSessions, RecState } from "@splates/server/rec/browser";
import { Circle, DicesIcon } from "lucide-react";
import { type JSX, useCallback, useEffect, useId, useState } from "react";
import { Badge } from "#web/components/ui/badge.tsx";
import { Button } from "#web/components/ui/button.tsx";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#web/components/ui/collapsible.tsx";
import { Input } from "#web/components/ui/input.tsx";
import { Switch } from "#web/components/ui/switch.tsx";
import { closeRec, openRec, recName, recSessions, recState } from "./api";
import { promptConversation, startAutoPick } from "./conversation-api";
import type { ConversationFeed } from "./conversation-feed";
import { HistoryRow, PLANNER_COLUMN } from "./history-row";
import { cn } from "./lib/utils";
import { bytesText } from "./rec-format";
import { RecHistory } from "./rec-history";
import { RecKeys } from "./rec-keys";
import { Live } from "./rec-live";
import { type LastOutcome, SavedRow } from "./rec-saved-row";
import { RecSession } from "./rec-session";
import { RouteTrail } from "./route-trail";
import { TopBar } from "./top-bar";

/**
 * The Rec page: opening a session, the history of saved ones (`#rec/history`)
 * and one session (`#rec/<name>`).
 */
export function RecPage({
	feed = null,
}: {
	feed?: ConversationFeed | null;
}): JSX.Element {
	const route = useRoute();
	if (route === null) {
		return <RecStart />;
	}
	return (
		<section aria-label="rec" className="flex min-w-0 flex-col gap-6">
			<TopBar
				title={
					<RouteTrail
						items={[
							{
								label: "Rec",
								onClick: () => {
									location.hash = "rec";
								},
							},
							...(route === HISTORY
								? [{ label: "History" }]
								: [
										{
											label: "History",
											onClick: () => {
												location.hash = `rec/${HISTORY}`;
											},
										},
										{ label: route },
									]),
						]}
					/>
				}
			/>
			{route === HISTORY ? (
				<div className={PLANNER_COLUMN}>
					<RecHistory />
				</div>
			) : (
				<RecSession
					name={route}
					sendToAgent={
						feed === null ? undefined : (name) => sendSessionToAgent(feed, name)
					}
					gone={(renamedTo) => {
						location.hash =
							renamedTo === undefined
								? `rec/${HISTORY}`
								: `rec/${encodeURIComponent(renamedTo)}`;
					}}
				/>
			)}
		</section>
	);
}

const readRoute = () => location.hash.match(/^#rec\/([^/]+)$/)?.[1] ?? null;

/** The `<x>` of `#rec/<x>`, kept as the hash changes. */
function useRoute(): string | null {
	const [route, setRoute] = useState(readRoute);
	useEffect(() => {
		const sync = () => setRoute(readRoute());
		window.addEventListener("hashchange", sync);
		return () => window.removeEventListener("hashchange", sync);
	}, []);
	return route === null ? null : decodeURIComponent(route);
}

/** Opens a conversation, on Auto pick, told to look into a session. */
async function sendSessionToAgent(
	feed: ConversationFeed,
	name: string,
): Promise<void> {
	const text = `Look into the rec session #rec:${name} with the rec skill and say what went wrong.`;
	const state = await startAutoPick({ words: text, task: null });
	feed.put(state);
	const sending = feed.send(state.id, text);
	void promptConversation(state.id, text, [], false, sending.id)
		.then((answered) => feed.answered(state.id, sending, answered))
		.catch((error: unknown) => feed.refused(state.id, sending, error));
	location.hash = `conversations/${state.id}`;
}

/** What `#rec/history` opens: every saved session. */
const HISTORY = "history";

/** How often the page asks rec whether it runs. */
const POLL_MS = 2000;

interface Followed {
	kind: "docker" | "file";
	name: string;
	on: boolean;
}

/** What `#rec` shows: a name, a page, what else to follow. */
function RecStart(): JSX.Element {
	const nameId = useId();
	const urlId = useId();
	const [state, setState] = useState<RecState | null>(null);
	const [name, setName] = useState("");
	const [url, setUrl] = useState("");
	const [chosen, setChosen] = useState<Record<string, boolean>>({});
	const [files, setFiles] = useState<string[]>([]);
	const [adding, setAdding] = useState<string | null>(null);
	const [opening, setOpening] = useState(false);
	const [problem, setProblem] = useState<string | null>(null);
	const [outcome, setOutcome] = useState<LastOutcome | null>(null);
	const [summary, setSummary] = useState<string | null>(null);
	useEffect(() => {
		recSessions().then(
			(store) => setSummary(sessionsSummary(store)),
			() => {},
		);
	}, []);

	useEffect(() => {
		let live = true;
		const read = () =>
			recState().then(
				(next) => {
					if (!live) {
						return;
					}
					setState(next);
					// Rec forgets its outcome when it exits, so keep the last one seen.
					if (next.status.lastOutcome !== undefined) {
						setOutcome(next.status.lastOutcome);
					}
				},
				() => {},
			);
		void read();
		const every = setInterval(read, POLL_MS);
		return () => {
			live = false;
			clearInterval(every);
		};
	}, []);

	const available = state?.available === true;
	const suggest = useCallback(() => {
		recName().then(setName, () => {});
	}, []);
	useEffect(() => {
		if (available && name === "") {
			suggest();
		}
	}, [available, name, suggest]);

	const followed: Followed[] = [
		...(state?.sources ?? []).map((each) => ({
			...each,
			on: chosen[`docker:${each.name}`] ?? false,
		})),
		...files.map((path) => ({
			kind: "file" as const,
			name: path,
			on: chosen[`file:${path}`] ?? true,
		})),
	];
	const running = state?.status.running === true;

	const reset = async () => {
		setOpening(false);
		setProblem(null);
		try {
			await closeRec();
		} catch (error) {
			setProblem((error as Error).message);
		}
		setState(await recState().catch(() => null));
	};

	const open = async () => {
		setOpening(true);
		setProblem(null);
		try {
			const on = (kind: Followed["kind"]) =>
				followed
					.filter((each) => each.kind === kind && each.on)
					.map((each) => each.name);
			await openRec({
				name,
				url: url.trim() === "" ? "about:blank" : url.trim(),
				docker: on("docker"),
				tails: on("file"),
			});
			setState(await recState());
		} catch (error) {
			setProblem((error as Error).message);
		} finally {
			setOpening(false);
		}
	};

	if (state?.here === false) {
		return (
			<section aria-label="rec" className="flex min-w-0 flex-col gap-6">
				<TopBar title="Rec" />
				<div className={cn(PLANNER_COLUMN, "gap-4")}>
					<p className="text-muted-foreground text-sm">
						Rec records on {state.host}, the machine running this server: open
						this page there to start one. Its saved sessions are here.
					</p>
					<RecHistory />
				</div>
			</section>
		);
	}

	return (
		<section aria-label="rec" className="flex min-w-0 flex-col gap-6">
			<TopBar title="Rec" />
			<div className={cn(PLANNER_COLUMN, "gap-4")}>
				<HistoryRow href="#rec/history" summary={summary} />
				<div className="flex flex-col gap-1">
					<h1 className="font-medium text-base">
						Show an agent what went wrong
					</h1>
					<p className="text-muted-foreground text-sm">
						Rec opens Chrome on a profile of its own. You browse and talk; it
						saves what you said, where you pointed, and the console, network and
						server logs, so an agent can act on it without watching video.
					</p>
				</div>
				{state !== null && !available && (
					<p role="alert" className="rounded-lg border p-4 text-sm">
						Rec is not on this server's PATH. It comes with splates: install{" "}
						<code>@stringsync/splates</code> globally (<code>bun add -g</code>)
						so its <code>rec</code> is on the PATH, then restart the server;
						until then Rec stays off. Rec needs Chrome and ffmpeg;{" "}
						<code>OPENAI_API_KEY</code> adds a transcript and{" "}
						<code>TYPESAFE_API_KEY</code> ranks the moments better. Run{" "}
						<code>rec skills add</code> in a project to teach its agent to read
						sessions.
					</p>
				)}
				{outcome !== null && <SavedRow outcome={outcome} />}
				{running && state !== null ? (
					<Live
						status={state.status}
						host={state.host}
						onClosed={() => recState().then(setState, () => {})}
					/>
				) : (
					<div className="flex flex-col gap-4 rounded-lg border bg-card p-4">
						<div className="grid gap-4 sm:grid-cols-2">
							<div className="flex flex-col gap-1.5 text-sm">
								<label htmlFor={nameId} className="font-medium">
									Session name
								</label>
								<span className="flex gap-2">
									<Input
										id={nameId}
										value={name}
										onChange={(event) => setName(event.target.value)}
										className="flex-1 font-mono"
									/>
									<Button
										type="button"
										variant="secondary"
										size="icon"
										aria-label="Suggest another name"
										disabled={!available}
										onClick={suggest}
									>
										<DicesIcon />
									</Button>
								</span>
							</div>
							<div className="flex flex-col gap-1.5 text-sm">
								<label htmlFor={urlId} className="font-medium">
									Open on
								</label>
								<Input
									id={urlId}
									value={url}
									placeholder="http://localhost:3000"
									onChange={(event) => setUrl(event.target.value)}
									className="font-mono"
								/>
							</div>
						</div>
						<div className="flex flex-col gap-2 text-sm">
							<span className="font-medium">Also follow</span>
							{followed.length > 0 && (
								<ul className="flex flex-col divide-y rounded-md border px-3">
									{followed.map((each) => (
										<li
											key={`${each.kind}:${each.name}`}
											className="flex items-center gap-3 py-2"
										>
											<Badge variant="secondary">
												{each.kind === "docker" ? "Docker" : "File"}
											</Badge>
											<span className="flex-1 truncate font-mono text-xs">
												{each.name}
											</span>
											<Switch
												aria-label={`Follow ${each.name}`}
												checked={each.on}
												onCheckedChange={(on) =>
													setChosen({
														...chosen,
														[`${each.kind}:${each.name}`]: on,
													})
												}
											/>
										</li>
									))}
								</ul>
							)}
							{state?.sourcesError !== undefined && (
								<span className="text-muted-foreground text-xs">
									Docker containers are not listed: {state.sourcesError}
								</span>
							)}
							{adding === null ? (
								<button
									type="button"
									className="w-fit text-muted-foreground text-xs hover:text-foreground"
									onClick={() => setAdding("")}
								>
									+ Follow a log file
								</button>
							) : (
								<form
									className="flex gap-2"
									onSubmit={(event) => {
										event.preventDefault();
										const path = adding.trim();
										if (path !== "" && !files.includes(path)) {
											setFiles([...files, path]);
										}
										setAdding(null);
									}}
								>
									<Input
										autoFocus
										value={adding}
										placeholder="/path/to/dev.log"
										onChange={(event) => setAdding(event.target.value)}
										className="font-mono"
									/>
									<Button type="submit" variant="secondary" size="sm">
										Add
									</Button>
								</form>
							)}
						</div>
						<Collapsible>
							<CollapsibleTrigger className="text-muted-foreground text-xs hover:text-foreground">
								Where sessions are kept
							</CollapsibleTrigger>
							<CollapsibleContent className="pt-1 text-muted-foreground text-xs">
								Rec keeps 5 GB of sessions and deletes the oldest first,
								whatever their name.
							</CollapsibleContent>
						</Collapsible>
						<div className="flex items-center gap-3 border-t pt-4">
							<span className="flex min-w-0 flex-1 flex-col gap-0.5 text-muted-foreground text-xs">
								<span>
									Nothing records until you press Start in Chrome's side panel
									{state === null ? "." : ` on ${state.host}.`}
								</span>
								{problem !== null && (
									<span className="text-destructive">{problem}</span>
								)}
							</span>
							<Button type="button" variant="ghost" size="sm" onClick={reset}>
								Reset
							</Button>
							<Button
								className="rounded-md bg-destructive px-4 text-white hover:bg-destructive/90 dark:bg-destructive dark:hover:bg-destructive/90"
								variant="destructive"
								disabled={!available || opening || name.trim() === ""}
								onClick={open}
							>
								<Circle className="size-3 fill-current" />
								Rec
							</Button>
						</div>
					</div>
				)}
				<RecKeys />
			</div>
		</section>
	);
}

/** What the History row says of the saved sessions, such as "12 sessions · 1.2 GB". */
function sessionsSummary(store: RecSessions): string | null {
	const count = store.sessions.length;
	return count === 0
		? null
		: `${count} ${count === 1 ? "session" : "sessions"} · ${bytesText(store.totalSize)}`;
}
