import type { TrustEntry, TrustScope } from "@splates/server/trust";
import { type JSX, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { Input } from "#web/components/ui/input.tsx";

export function TrustScopes({
	projects,
	selected,
	scopes,
	entries,
	onChange,
}: {
	projects: { path: string; name: string }[];
	selected: string | null;
	scopes: TrustScope[];
	entries: TrustEntry[];
	onChange: (method: "POST" | "DELETE", scope: TrustScope) => Promise<boolean>;
}): JSX.Element {
	const [picked, setPicked] = useState<string | null>(null);
	const [path, setPath] = useState("");
	const [saving, setSaving] = useState(false);
	const project = selected ?? picked ?? projects[0]?.path ?? "";
	const change = async (method: "POST" | "DELETE", scope: TrustScope) => {
		setSaving(true);
		try {
			if ((await onChange(method, scope)) && method === "POST") {
				setPath("");
			}
		} finally {
			setSaving(false);
		}
	};
	return (
		<>
			{projects.length > 0 && (
				<form
					className="grid grid-cols-[minmax(0,1fr)_auto] gap-2.5 rounded-xl border bg-card p-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]"
					onSubmit={(event) => {
						event.preventDefault();
						if (!saving && project !== "" && path.trim() !== "") {
							void change("POST", { project, path });
						}
					}}
				>
					<select
						aria-label="Project"
						className="col-span-2 h-9 min-w-0 rounded-md border bg-background px-2.5 text-sm sm:col-span-1 sm:max-w-48"
						value={project}
						onChange={(event) => setPicked(event.target.value)}
						disabled={saving || selected !== null}
					>
						{projects.map(({ path, name }) => (
							<option key={path} value={path}>
								{name}
							</option>
						))}
					</select>
					<Input
						aria-label="Directory path"
						placeholder="e.g. packages/web/"
						value={path}
						onChange={(event) => setPath(event.target.value)}
						disabled={saving}
						className="h-9 min-w-0 bg-background font-mono"
					/>
					<Button
						type="submit"
						className="h-9"
						disabled={saving || project === "" || path.trim() === ""}
					>
						Add scope
					</Button>
				</form>
			)}
			{projects
				.filter((each) => selected === null || each.path === selected)
				.map(({ path, name }) => {
					const declared = scopes
						.filter((each) => each.project === path)
						.toSorted((left, right) => left.path.localeCompare(right.path));
					return (
						<section
							key={path}
							aria-label={name}
							className="flex flex-col gap-2.5"
						>
							<div className="flex items-baseline justify-between px-0.5 text-muted-foreground text-xs">
								<h2
									title={path}
									className="font-medium uppercase tracking-wider"
								>
									{name}
								</h2>
								<span>
									{declared.length === 0
										? "No custom scopes"
										: counted(declared.length, "scope")}
								</span>
							</div>
							{declared.length === 0 ? (
								<p className="rounded-xl border bg-card p-3.5 text-muted-foreground text-sm">
									All models in <b>{name}</b> use the project default.
								</p>
							) : (
								<ul className="divide-y overflow-hidden rounded-xl border bg-card">
									{declared.map((scope) => {
										const models = entries.filter(
											(entry) =>
												entry.project === scope.project &&
												entry.scope === scope.path,
										);
										const decisions = models.reduce(
											(total, each) => total + each.counts.total,
											0,
										);
										return (
											<li
												key={scope.path}
												className="flex items-center justify-between gap-3 px-3.5 py-3"
											>
												<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
													<code className="wrap-anywhere rounded-md bg-muted px-1.5 py-0.5">
														{scope.path}
													</code>
													<span className="text-muted-foreground text-xs">
														{counted(models.length, "model")} ·{" "}
														{counted(decisions, "decision")}
													</span>
												</div>
												<Button
													type="button"
													variant="outline"
													className="h-9 shrink-0 text-destructive hover:text-destructive"
													size="sm"
													aria-label={`Remove ${scope.path}`}
													disabled={saving}
													onClick={() => void change("DELETE", scope)}
												>
													Remove
												</Button>
											</li>
										);
									})}
								</ul>
							)}
						</section>
					);
				})}
			{projects.length === 0 && (
				<p className="text-muted-foreground text-sm">No projects available.</p>
			)}
		</>
	);
}

function counted(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
