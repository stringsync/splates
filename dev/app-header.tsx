import { type JSX, useEffect, useState } from "react";
import { cn } from "#dev/lib/utils.ts";
import type { Snapshot } from "../snapshot";
import { identity } from "./api";
import { CheckpointRefusal } from "./checkpoint";
import { PageMenu } from "./page-menu";
import { ProjectSwitcher } from "./projects";

/**
 * Heads the sidebar when there is one, and the page on a phone: the project
 * switcher, a badge when the server is outdated, unbuilt or offline, the page
 * menu, the project's path, who Cloudflare Access signed in, and why a
 * checkpoint could not start.
 */
export function AppHeader({
	name,
	snapshot,
	outdated,
	offline,
	conversations,
	wide,
	onSettings,
}: {
	name: string;
	snapshot: Snapshot | null;
	/** Why a newer arbor has the server refusing, or null. */
	outdated: string | null;
	offline: boolean;
	/** Whether `arbor dev` holds conversations. */
	conversations: boolean;
	wide: boolean;
	onSettings: () => void;
}): JSX.Element {
	// Whether Restart says a restart would update arbor, with a dot.
	const hinted =
		(snapshot?.release != null || snapshot?.behind != null) &&
		outdated === null &&
		!offline;
	return (
		<header
			className={cn(
				"flex min-w-0 flex-col gap-0.5",
				wide
					? "fixed top-0 left-0 z-50 w-(--sidebar-width) px-6 pt-5"
					: "border-b px-4 py-2.5",
			)}
		>
			<div className="flex min-w-0 items-center gap-2">
				<ProjectSwitcher name={name} />
				{/* Silent while connected, which is the normal case. Once the
									    server stops answering, the page says so, since what it
									    shows may no longer be true. */}
				{/* Up but refusing: a newer arbor moved the records on. */}
				{outdated !== null && !offline && (
					<span
						role="status"
						title={outdated}
						className="flex shrink-0 items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-medium text-[11px] text-amber-600 leading-none dark:text-amber-400"
					>
						<span className="size-1.5 rounded-full bg-amber-500" />
						Outdated
					</span>
				)}
				{/* Up, but serving the page built before, since building this
									    one failed, as when a merge added a package. */}
				{snapshot?.unbuilt === true && outdated === null && !offline && (
					<span
						role="status"
						title="Building this page failed as arbor dev started, so it may be out of date: the terminal running arbor dev says why"
						className="flex shrink-0 items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-medium text-[11px] text-amber-600 leading-none dark:text-amber-400"
					>
						<span className="size-1.5 rounded-full bg-amber-500" />
						Build failed
					</span>
				)}
				{offline && (
					<span
						role="status"
						title="arbor dev stopped answering: is it still running?"
						className="flex shrink-0 items-center gap-1.5 rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 font-medium text-[11px] text-destructive leading-none"
					>
						<span className="size-1.5 rounded-full bg-destructive" />
						Offline
					</span>
				)}
				<PageMenu
					release={hinted ? (snapshot?.release ?? null) : null}
					behind={hinted ? (snapshot?.behind ?? null) : null}
					conversations={conversations}
					onSettings={onSettings}
				/>
			</div>
			{snapshot && (
				<span className="truncate text-muted-foreground text-xs">
					{snapshot.path}
				</span>
			)}
			<SignedIn />
			{/* Out of the menu that asked, which has closed. */}
			<CheckpointRefusal className="pt-1" />
		</header>
	);
}

/**
 * Who Cloudflare Access signed in, when the page came through it; nothing on
 * this machine, where no one signs in.
 */
function SignedIn(): JSX.Element | null {
	const [email, setEmail] = useState<string | null>(null);
	useEffect(() => {
		identity().then(setEmail, () => {});
	}, []);
	return email === null ? null : (
		<span className="truncate text-muted-foreground text-xs">
			Signed in as {email}
		</span>
	);
}
