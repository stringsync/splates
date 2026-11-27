import type { ProjectRef } from "@splates/server/conversations";
import type { AssumptionView } from "@splates/server/trust";
import { KIND_LABELS, overturnMessage } from "@splates/server/trust/browser";
import { type JSX, useCallback, useEffect, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { AgentMark } from "./agent-icons";
import {
	type AssumptionsPage,
	markAssumptionWrong,
	queueFollowUp,
	readAssumptions,
} from "./api/trust";
import { promptConversation } from "./conversation-api";
import { ago } from "./signal-of";
import { modelName, projectName } from "./trust-page";

/**
 * The Trust page's Assumptions tab: a calm, paged log of the calls agents
 * made without asking, newest first. A row whose conversation is still at
 * work offers Overturn, which tells the agent; a finished one offers Mark
 * wrong, which only counts against trust, and Queue follow-up, which marks it
 * wrong and adds a task to change it; an overturned one shows what it became.
 */
export function TrustAssumptions({
	project,
	projects,
	now = Date.now(),
}: {
	/** The project root shown, or null for every one. */
	project: string | null;
	/** The projects on this machine, by root, for their slugs. */
	projects: readonly ProjectRef[];
	now?: number;
}): JSX.Element {
	const [page, setPage] = useState(1);
	const [log, setLog] = useState<AssumptionsPage | null>(null);
	const [failed, setFailed] = useState<string | null>(null);
	const load = useCallback(
		() =>
			readAssumptions(page, project)
				.then((read) => {
					setLog(read);
					setFailed(null);
				})
				.catch((error: unknown) => setFailed(String(error))),
		[page, project],
	);
	useEffect(() => {
		void load();
	}, [load]);
	useEffect(() => setPage(1), []);
	const slugOf = (root: string) =>
		projects.find((each) => each.root === root)?.slug ?? null;
	const act = async (run: () => Promise<void>) => {
		try {
			await run();
			await load();
		} catch (error) {
			setFailed(String(error));
		}
	};
	return (
		<div className="flex flex-col gap-4">
			{failed !== null && (
				<p role="alert" className="text-destructive text-sm">
					{failed}
				</p>
			)}
			{log === null ? (
				failed === null && (
					<p className="text-muted-foreground text-sm">Reading assumptions…</p>
				)
			) : log.total === 0 ? (
				<p className="text-muted-foreground text-sm">
					No assumptions yet. Agents at 90 trust or more make reversible calls
					themselves, and each shows here.
				</p>
			) : (
				<>
					<ul
						aria-label="assumptions"
						className="divide-y overflow-hidden rounded-xl border bg-card"
					>
						{log.assumptions.map((each) => (
							<AssumptionRow
								key={each.id}
								assumption={each}
								slug={slugOf(each.project)}
								now={now}
								onOverturn={(slug) =>
									act(async () => {
										await promptConversation(
											each.conversation,
											overturnMessage(
												each.number,
												each.assumed,
												each.alternative,
											),
											[],
											false,
											undefined,
											undefined,
											slug,
										);
									})
								}
								onMarkWrong={() => act(() => markAssumptionWrong(each.id))}
								onFollowUp={(slug) =>
									act(async () => {
										await queueFollowUp(slug, each);
										await markAssumptionWrong(each.id);
									})
								}
							/>
						))}
					</ul>
					<nav
						aria-label="pages"
						className="flex items-center justify-between gap-3 text-sm"
					>
						<Button
							variant="outline"
							size="sm"
							disabled={log.page <= 1}
							onClick={() => setPage(log.page - 1)}
						>
							← Previous
						</Button>
						<span className="text-muted-foreground tabular-nums">
							Page {log.page} of {log.pages} · {log.total}{" "}
							{log.total === 1 ? "assumption" : "assumptions"}
						</span>
						<Button
							variant="outline"
							size="sm"
							disabled={log.page >= log.pages}
							onClick={() => setPage(log.page + 1)}
						>
							Next →
						</Button>
					</nav>
				</>
			)}
		</div>
	);
}

/** One assumption: who made it where, what and instead of what, and what can be done about it. */
function AssumptionRow({
	assumption,
	slug,
	now,
	onOverturn,
	onMarkWrong,
	onFollowUp,
}: {
	assumption: AssumptionView;
	/** Its project's slug, or null when the page does not know it. */
	slug: string | null;
	now: number;
	onOverturn: (slug: string) => Promise<void>;
	onMarkWrong: () => Promise<void>;
	onFollowUp: (slug: string) => Promise<void>;
}): JSX.Element {
	const [busy, setBusy] = useState(false);
	const [told, setTold] = useState(false);
	const run = (action: () => Promise<void>) => {
		setBusy(true);
		void action().finally(() => setBusy(false));
	};
	const { overturned, open = false } = assumption;
	const link =
		slug === null
			? null
			: `?${new URLSearchParams({ project: slug })}#conversations/${encodeURIComponent(assumption.conversation)}`;
	return (
		<li
			aria-label={assumption.assumed}
			className="flex items-start gap-3 px-3.5 py-3 max-sm:flex-col"
		>
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<div className="flex flex-wrap items-center gap-1.5 text-xs">
					<AgentMark agent={assumption.agent} />
					<span className="font-medium">{modelName(assumption)}</span>
					<Pill>{projectName(assumption.project)}</Pill>
					<Pill>{KIND_LABELS[assumption.kind]}</Pill>
					{overturned !== null && (
						<span className="rounded-full bg-destructive/12 px-2 py-px font-medium text-destructive">
							Overturned
						</span>
					)}
					<span className="text-muted-foreground">
						{ago(overturned?.at ?? assumption.at, now)}
					</span>
				</div>
				{overturned === null ? (
					<p className="font-medium text-sm">{assumption.assumed}</p>
				) : (
					<p className="text-muted-foreground text-sm">
						<span className="line-through">{assumption.assumed}</span> →{" "}
						<span className="font-medium text-foreground">
							{overturned.instead}
						</span>
					</p>
				)}
				<p className="text-muted-foreground text-xs">
					{overturned === null && <>Alternative: {assumption.alternative} · </>}
					{link === null ? (
						(assumption.task ?? "Conversation")
					) : (
						<a href={link} className="underline underline-offset-2">
							{assumption.task ?? "Conversation"}
						</a>
					)}
				</p>
			</div>
			{overturned === null && (
				<div className="flex shrink-0 gap-1.5">
					{open && slug !== null ? (
						told ? (
							<span className="text-muted-foreground text-sm">
								Sent to agent
							</span>
						) : (
							<Button
								variant="outline"
								size="sm"
								disabled={busy}
								onClick={() =>
									run(async () => {
										await onOverturn(slug);
										setTold(true);
									})
								}
							>
								Overturn
							</Button>
						)
					) : (
						<>
							<Button
								variant="outline"
								size="sm"
								disabled={busy}
								onClick={() => run(onMarkWrong)}
							>
								Mark wrong
							</Button>
							{slug !== null && (
								<Button
									variant="outline"
									size="sm"
									disabled={busy}
									title="Marks it wrong and adds a Backlog task to switch the code to the alternative"
									onClick={() => run(() => onFollowUp(slug))}
								>
									Queue follow-up
								</Button>
							)}
						</>
					)}
				</div>
			)}
		</li>
	);
}

function Pill({ children }: { children: string }): JSX.Element {
	return (
		<span className="rounded-full border px-2 py-px text-muted-foreground">
			{children}
		</span>
	);
}
