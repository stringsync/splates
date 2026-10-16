import { Loader2Icon } from "lucide-react";
import { type JSX, useContext, useState } from "react";
import { Button } from "#dev/components/ui/button.tsx";
import { Input } from "#dev/components/ui/input.tsx";
import { cn } from "#dev/lib/utils.ts";
import type { Added } from "../dev-picker";
import { NavigationContext } from "./navigation";
import { addProject, commitProject } from "./project-api";
import { projectUrl } from "./project-places";
import { Refusal, useRefusal } from "./refusal";

/**
 * Adds a project by its path on this machine, running `arbor init` there,
 * then asks before committing what init wrote, in place, and opens it.
 */
export function AddProject({
	className,
	autoFocus = false,
}: {
	className?: string;
	autoFocus?: boolean;
}): JSX.Element {
	const [path, setPath] = useState("");
	const [busy, setBusy] = useState(false);
	// Set once init ran and left files to commit, until the person says.
	const [added, setAdded] = useState<Added | null>(null);
	const navigation = useContext(NavigationContext);
	const { refusal, refuse } = useRefusal();

	const open = (slug: string) => navigation.go(projectUrl({ slug }));

	if (added !== null) {
		const { project, uncommitted, shown, branch } = added;
		return (
			<fieldset
				aria-label={`Commit what arbor init wrote in ${project.slug}`}
				className={cn("flex flex-col gap-2 px-2 text-sm", className)}
			>
				<p>
					arbor init wrote{" "}
					{shown.map((file, at) => (
						<span key={file}>
							{at > 0 && ", "}
							<code className="font-mono text-xs">{file}</code>
						</span>
					))}{" "}
					in {project.slug}. Commit {shown.length === 1 ? "it" : "them"}
					{branch === null ? "" : ` on ${branch}`}?
				</p>
				<div className="flex gap-2">
					<Button
						size="sm"
						disabled={busy}
						onClick={() => {
							setBusy(true);
							commitProject(project.slug, uncommitted).then(
								() => open(project.slug),
								(error: unknown) => {
									setBusy(false);
									refuse("Not committed", error);
								},
							);
						}}
					>
						{busy ? "Committing…" : "Commit"}
					</Button>
					<Button
						size="sm"
						variant="ghost"
						disabled={busy}
						onClick={() => open(project.slug)}
					>
						Leave uncommitted
					</Button>
				</div>
				<Refusal refusal={refusal} />
			</fieldset>
		);
	}

	return (
		<form
			aria-label="Add a project"
			className={cn("flex flex-col gap-1.5 px-2", className)}
			onSubmit={(event) => {
				event.preventDefault();
				if (path.trim() === "" || busy) {
					return;
				}
				setBusy(true);
				addProject(path).then(
					(result) => {
						if (result.uncommitted.length === 0) {
							open(result.project.slug);
						} else {
							setBusy(false);
							setAdded(result);
						}
					},
					(error: unknown) => {
						setBusy(false);
						refuse("Not added", error);
					},
				);
			}}
		>
			<div className="flex gap-2">
				<Input
					autoFocus={autoFocus}
					aria-label="project path"
					placeholder="~/Projects/app"
					value={path}
					disabled={busy}
					onChange={(event) => setPath(event.target.value)}
					onKeyDown={(event) => event.stopPropagation()}
				/>
				<Button type="submit" size="sm" disabled={busy || path.trim() === ""}>
					{busy ? "Setting up…" : "Add"}
				</Button>
			</div>
			<p className="text-muted-foreground text-xs">
				A repository on this machine; arbor init runs there.
			</p>
			<Refusal refusal={refusal} />
		</form>
	);
}

/**
 * What the page shows in place of a project when it has none to show: why,
 * as the server says it, and a way to add one.
 */
export function NoProject({ message }: { message: string }): JSX.Element {
	return (
		<div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-24">
			<p role="status" className="text-muted-foreground text-sm">
				{message.charAt(0).toUpperCase() + message.slice(1)}
			</p>
			<AddProject autoFocus className="w-full max-w-sm" />
		</div>
	);
}

/**
 * What the page shows before a project's first snapshot: the server opens a
 * project on its first read, which takes seconds. Offline or outdated, the
 * header already says why nothing came; with no project to show, the page
 * asks for one.
 */
export function Opening({
	missing,
	waiting,
	name,
}: {
	/** Why there is no project to show, or null while one opens. */
	missing: string | null;
	/** Whether the server is reachable and current, so one is on its way. */
	waiting: boolean;
	name: string;
}): JSX.Element | null {
	if (missing !== null) {
		return <NoProject message={missing} />;
	}
	return waiting ? (
		<div
			role="status"
			className="flex flex-1 items-center justify-center gap-2 py-24 text-muted-foreground text-sm"
		>
			<Loader2Icon className="size-4 animate-spin" />
			Opening {name}
		</div>
	) : null;
}
