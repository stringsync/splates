import type {
	AwsAccess,
	CoordinatorNeeds,
	FieldProgress,
} from "@stringsync/splates-server/setup";
import { useReactive } from "@webappwiz/react";
import { ExternalLinkIcon } from "lucide-react";
import { createContext, type JSX, type ReactNode, useContext } from "react";
import { Dispatcher, type Eventful } from "webappwiz/events";
import { Duration, sleep } from "webappwiz/time";
import { Badge } from "#web/components/ui/badge.tsx";
import { buttonVariants } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";
import { coordinatorMoveProgress, startCoordinatorMove } from "./setup-api";
import { StepField } from "./setup-form";
import { CommandBlock, StepInstructions } from "./setup-instructions";
import type { BrowserSteps } from "./setup-journey";
import type { StepBodies } from "./setup-steps";

/**
 * Where a move the page started stands: not started, run by this server, or
 * on its way to the box once this server is gone, `long` once that has
 * taken longer than a move should; `failed` with what it said when it
 * stopped before this server did.
 */
export type MoveState =
	| { kind: "idle" }
	| { kind: "here"; line: string | null }
	| { kind: "away"; host: string | null; long: boolean }
	| { kind: "failed"; log: string[] };

export type MoveWatchEvents = { changed: undefined };

/** How long the box may take to answer once this server is gone, before the page says so. */
const AWAY_LONG = Duration.mins(10);

/**
 * Starts the move and follows it: through this server while it runs it,
 * then, once this server has stopped, as the move asks, by asking the same
 * address again until the box answers there, through the tunnel.
 */
export class MoveWatch implements Eventful<MoveWatchEvents> {
	private readonly dispatcher = new Dispatcher<MoveWatchEvents>();
	readonly events = this.dispatcher.events;
	state: MoveState = { kind: "idle" };
	private stopped = false;

	constructor(private readonly opts: MoveWatchOptions = {}) {}

	/**
	 * Resolves once the coordinator has moved, as the server at this
	 * address says; throws, saying so in one line, when the move stopped
	 * before this server did.
	 */
	async run(): Promise<void> {
		const pause = this.opts.pause ?? Duration.secs(2);
		const now = this.opts.now ?? Date.now;
		this.stopped = false;
		let read = await startCoordinatorMove();
		let host = read.host;
		let away: number | null = null;
		for (;;) {
			if (read.moved && !read.unfinished) {
				this.set({ kind: "idle" });
				return;
			}
			if (read.exitCode !== null && read.exitCode !== 0) {
				this.set({ kind: "failed", log: read.log });
				throw new Error(
					read.unfinished
						? "The deploy stopped once the server ran on its box, before this Mac joined it as a worker: what it said is below. Once that is fixed, Next finishes it."
						: "The deploy stopped before this server did, so nothing here changed: what it said is below.",
				);
			}
			this.set({ kind: "here", line: read.log.at(-1) ?? null });
			for (;;) {
				await sleep(pause);
				if (this.stopped) {
					throw new Error("The page stopped following the deploy.");
				}
				const next = await coordinatorMoveProgress().catch(() => null);
				if (next !== null) {
					read = next;
					host = next.host ?? host;
					away = null;
					break;
				}
				away ??= now();
				this.set({
					kind: "away",
					host,
					long: now() - away > AWAY_LONG.ms,
				});
			}
		}
	}

	/** Stops following, as once the page leaves the move's step; the move carries on. */
	stop(): void {
		this.stopped = true;
	}

	private set(state: MoveState): void {
		this.state = state;
		this.dispatcher.dispatch("changed");
	}
}

/** How a `MoveWatch` looks: how often, and by what clock. */
export interface MoveWatchOptions {
	/** How long to wait between looks. */
	pause?: Duration;
	now?: () => number;
}

/** The move the page follows, for the move step's body. */
export const MoveWatchContext = createContext<MoveWatch | null>(null);

/** What the move step does in this browser: the whole move, which the server cannot see through. */
export function coordinatorBrowserSteps(watch: MoveWatch): BrowserSteps {
	return { "coordinator-move": () => watch.run() };
}

/**
 * The sign-in page, CloudShell's link, its command and the account id each
 * under its own step; the creds page, each cred the box lacks under the
 * step that makes them; and the move's page, following it.
 */
export const COORDINATOR_STEPS: StepBodies = {
	"coordinator-access": ({ step }) => (
		<StepInstructions
			text={step.user}
			under={accessUnder(step.data as AwsAccess | null, step.fields)}
		/>
	),
	"coordinator-creds": ({ step }) => {
		const needs = (step.data as CoordinatorNeeds | null)?.needs ?? [];
		return (
			<StepInstructions
				text={step.user}
				under={{
					2: needs.length > 0 && (
						<ul aria-label="missing creds" className="flex flex-wrap gap-1.5">
							{needs.map((name) => (
								<li key={name}>
									<Badge variant="outline" className="font-mono">
										{name}
									</Badge>
								</li>
							))}
						</ul>
					),
				}}
			/>
		);
	},
	"coordinator-move": ({ step }) => <MoveBody user={step.user} />,
};

/**
 * CloudShell's link, the command to paste there and the account id it
 * prints, or, before Pulumi is logged in to an organization, what to do first.
 */
function accessUnder(
	access: AwsAccess | null,
	fields: readonly FieldProgress[],
): Record<number, ReactNode> {
	const field = fields.map((each) => (
		<StepField key={each.name} field={each} />
	));
	if (access === null) {
		return {
			2: (
				<p className="text-muted-foreground text-sm">
					Log Pulumi in to Pulumi Cloud first, the step before, and the command
					shows here.
				</p>
			),
			3: field,
		};
	}
	return {
		1: (
			<a
				href={access.cloudShell}
				target="_blank"
				rel="noreferrer"
				className={cn(
					buttonVariants({ variant: "outline", size: "sm" }),
					"self-start",
				)}
			>
				Open AWS CloudShell
				<ExternalLinkIcon data-icon="inline-end" aria-hidden />
			</a>
		),
		2: <CommandBlock command={access.command} />,
		3: field,
	};
}

/** The move's page: its steps, then where the move stands once Next starts it. */
function MoveBody({ user }: { user: string }): JSX.Element {
	const watch = useContext(MoveWatchContext);
	const state = useReactive(watch ?? IDLE, (each) => each.state, ["changed"]);
	return (
		<StepInstructions text={user} under={{ 2: <MoveStatus state={state} /> }} />
	);
}

/** No move to follow, for a page drawn without one. */
const IDLE = new MoveWatch();

function MoveStatus({ state }: { state: MoveState }): JSX.Element | null {
	switch (state.kind) {
		case "idle":
			return null;
		case "here":
			return (
				<p role="status" className="text-muted-foreground text-sm">
					{state.line ?? "Starting the deploy…"}
				</p>
			);
		case "away": {
			const box = state.host === null ? null : `https://${state.host}`;
			const elsewhere = state.host !== null && state.host !== location.host;
			return (
				<div role="status" className="flex flex-col gap-2 text-sm">
					<p className="text-muted-foreground">
						This machine's server has stopped, as the deploy asks. The records
						and creds go to the box, and this page carries on once the box
						answers here.
					</p>
					{elsewhere && box !== null && (
						<p>
							This page is on this Mac, so it cannot follow the deploy: open{" "}
							<a
								href={box}
								className="underline underline-offset-4"
								target="_blank"
								rel="noreferrer"
							>
								{box}
							</a>{" "}
							in a few minutes.
						</p>
					)}
					{state.long && (
						<p className="text-destructive">
							The box has not answered in ten minutes: read
							~/.splates/coordinator/move.log on this Mac for what the deploy
							said.
						</p>
					)}
				</div>
			);
		}
		case "failed":
			return (
				<pre className="overflow-x-auto whitespace-pre-wrap rounded-md border bg-muted px-2 py-1 font-mono text-[12px]">
					{state.log.join("\n")}
				</pre>
			);
	}
}
