import type { TrustEntry, TrustScope } from "@splates/server/trust";
import { type JSX, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { Card, CardList } from "#web/components/ui/card.tsx";
import { Input } from "#web/components/ui/input.tsx";
import { PageSection } from "./page-section";
import { ScopeChip } from "./trust-badges";

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
				<Card
					render={<form />}
					className="grid grid-cols-[minmax(0,1fr)_auto] gap-2.5 p-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]"
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
				</Card>
			)}
			{projects
				.filter((each) => selected === null || each.path === selected)
				.map(({ path, name }) => {
					const declared = scopes
						.filter((each) => each.project === path)
						.toSorted((left, right) => left.path.localeCompare(right.path));
					return (
						<PageSection
							key={path}
							aria-label={name}
							title={<span title={path}>{name}</span>}
							count={
								declared.length === 0
									? "No custom scopes"
									: counted(declared.length, "scope")
							}
						>
							{declared.length === 0 ? (
								<Card className="p-3.5 text-muted-foreground text-sm">
									<p>
										All models in <b>{name}</b> use the project default.
									</p>
								</Card>
							) : (
								<Card>
									<CardList>
										{declared.map((scope) => {
											const models = entries.filter(
												(entry) =>
													entry.project === scope.project &&
													entry.scope === scope.path,
											);
											const sessions = models.reduce(
												(total, each) => total + each.standing.sessions,
												0,
											);
											return (
												<li
													key={scope.path}
													className="flex items-center justify-between gap-3 px-3.5 py-3"
												>
													<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
														<ScopeChip path={scope.path} />
														<span className="text-muted-foreground text-xs">
															{counted(models.length, "model")} ·{" "}
															{counted(sessions, "session")}
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
									</CardList>
								</Card>
							)}
						</PageSection>
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
