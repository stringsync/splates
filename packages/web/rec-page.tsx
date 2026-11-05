import type { RecState } from "@splates/server/rec/browser";
import {
	Circle,
	DicesIcon,
	HistoryIcon,
	Laser,
	Mic,
	MicOff,
	SquareIcon,
} from "lucide-react";
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
import { closeRec, openRec, recName, recState } from "./api";
import { promptConversation, startAutoPick } from "./conversation-api";
import type { ConversationFeed } from "./conversation-feed";
import { RecHistory } from "./rec-history";
import { RecKeys } from "./rec-keys";
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
				<RecHistory />
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

	useEffect(() => {
		let live = true;
		const read = () =>
			recState().then(
				(next) => live && setState(next),
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

	return (
		<section aria-label="rec" className="flex min-w-0 flex-col gap-6">
			<TopBar
				title="Rec"
				actions={[
					{
						label: "History",
						text: "History",
						icon: <HistoryIcon />,
						run: () => {
							location.hash = "rec/history";
						},
					},
				]}
			/>
			<div className="flex flex-col gap-1">
				<h1 className="font-medium text-base">Show an agent what went wrong</h1>
				<p className="text-muted-foreground text-sm">
					Rec opens Chrome on a profile of its own. You browse and talk; it
					saves what you said, where you pointed, and the console, network and
					server logs, so an agent can act on it without watching video.
				</p>
			</div>
			{state !== null && !available && (
				<p role="alert" className="rounded-lg border p-4 text-sm">
					Rec is not on this server's PATH. It comes with splates: install{" "}
					<code>@stringsync/splates</code> globally (<code>bun add -g</code>) so
					its <code>rec</code> is on the PATH, then restart the server; until
					then Open rec stays off. Rec needs Chrome and ffmpeg;{" "}
					<code>OPENAI_API_KEY</code> adds a transcript and{" "}
					<code>TYPESAFE_API_KEY</code> ranks the moments better. Run{" "}
					<code>rec skills add</code> in a project to teach its agent to read
					sessions.
				</p>
			)}
			{running && state !== null ? (
				<Live
					status={state.status}
					host={state.host}
					onClosed={() => recState().then(setState, () => {})}
				/>
			) : (
				<div className="flex flex-col gap-4 rounded-lg border bg-card p-4">
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
							Rec keeps 5 GB of sessions and deletes the oldest first, whatever
							their name.
						</CollapsibleContent>
					</Collapsible>
					<div className="flex items-center gap-3 border-t pt-4">
						<span className="flex min-w-0 flex-1 flex-col gap-0.5 text-muted-foreground text-xs">
							<span>
								Nothing records until you press Start in Chrome's side panel.
							</span>
							{state !== null && (
								<span>
									Chrome opens on {state.host}, the machine running this server.
								</span>
							)}
							{problem !== null && (
								<span className="text-destructive">{problem}</span>
							)}
						</span>
						<Button type="button" variant="ghost" size="sm" onClick={reset}>
							Reset rec
						</Button>
						<Button
							className="rounded-full bg-destructive text-white hover:bg-destructive/90 dark:bg-destructive dark:hover:bg-destructive/90"
							variant="destructive"
							disabled={!available || opening || name.trim() === ""}
							onClick={open}
						>
							<Circle className="size-3 fill-current" />
							Open rec
						</Button>
					</div>
				</div>
			)}
			<RecKeys />
		</section>
	);
}

/** Shows the running rec, and ends it with Close rec. */
export function Live({
	status,
	host,
	onClosed,
}: {
	status: RecState["status"];
	host: string;
	onClosed: () => void;
}): JSX.Element {
	const [closing, setClosing] = useState(false);
	const [problem, setProblem] = useState<string | null>(null);
	const close = async () => {
		setClosing(true);
		setProblem(null);
		try {
			await closeRec();
			onClosed();
		} catch (error) {
			setProblem((error as Error).message);
		} finally {
			setClosing(false);
		}
	};
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const every = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(every);
	}, []);
	const recording = status.recording === true;
	const elapsed =
		recording && status.startedAt !== undefined
			? Math.max(0, Math.floor((now - status.startedAt) / 1000))
			: null;
	return (
		<div className="flex flex-col gap-4 rounded-lg border bg-card p-4">
			<div className="flex flex-col gap-0.5">
				<span className="font-medium font-mono text-sm">{status.name}</span>
				<span className="text-muted-foreground text-xs">
					{recording ? "Recording" : "Waiting for Start"} in Chrome on {host}
				</span>
			</div>
			<div className="flex items-center gap-2 rounded-md border px-3 py-3">
				<div className="flex items-center gap-2 pr-1">
					<span
						className={
							recording
								? "size-2.5 rounded-full bg-destructive shadow-[0_0_0_4px] shadow-destructive/20"
								: "size-2.5 rounded-full bg-muted-foreground/40"
						}
					/>
					<span className="font-mono text-lg tabular-nums">
						{elapsed === null
							? "0:00"
							: `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`}
					</span>
				</div>
				{status.mic !== undefined && (
					<div className="flex h-8 items-center gap-1.5 rounded-md bg-secondary px-2.5">
						{status.mic === "on" ? (
							<Mic className="size-4" />
						) : (
							<MicOff className="size-4" />
						)}
					</div>
				)}
				{status.laser !== undefined && (
					<div
						className={
							status.laser
								? "flex h-8 items-center rounded-md bg-secondary px-2 text-foreground"
								: "flex h-8 items-center rounded-md bg-secondary px-2 text-muted-foreground"
						}
					>
						<Laser className="size-4" />
					</div>
				)}
			</div>
			<div className="flex items-end justify-between gap-3">
				<span className="flex flex-col gap-1 text-muted-foreground text-xs">
					<span>
						Start and Stop stay in Chrome's side panel. Each Stop saves a
						session, then transcribes and ranks it.
					</span>
					<span>
						Close rec saves anything recording, closes rec's Chrome and ends
						rec.
					</span>
					{problem !== null && (
						<span className="text-destructive">{problem}</span>
					)}
				</span>
				<Button
					type="button"
					variant="destructive"
					size="sm"
					disabled={closing}
					onClick={close}
				>
					<SquareIcon className="size-3 fill-current" />
					{closing ? "Closing…" : "Close rec"}
				</Button>
			</div>
		</div>
	);
}
