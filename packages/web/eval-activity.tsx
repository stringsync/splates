import type { StoredEvalLoop } from "@splates/server/evals/browser";
import { type JSX, useEffect, useState } from "react";
import { answered, scoped } from "./api/request";
import { EvalSection } from "./eval-section";

/** Browse active improvements and open their owning conversations. */
export function EvalActivity(): JSX.Element {
	const [loops, setLoops] = useState<StoredEvalLoop[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		let current = true;
		answered(scoped("/api/evals/loop"))
			.then(async (response) => {
				if (!response.ok) {
					throw new Error("Could not read improvement activity");
				}
				const saved = (await response.json()) as StoredEvalLoop[];
				if (current) {
					setLoops(
						saved.filter(
							(each) =>
								each.loop.stage.kind !== "complete" &&
								each.loop.stage.kind !== "stopped",
						),
					);
				}
			})
			.catch((failed: unknown) => {
				if (current) {
					setError(String(failed));
				}
			});
		return () => {
			current = false;
		};
	}, []);
	return (
		<EvalSection
			label="improvements"
			title="Active improvements"
			count={loops?.length ?? 0}
		>
			<p className="text-muted-foreground text-sm">
				Start runs and guide improvements in a conversation. Browse their
				evidence here.
			</p>
			{error !== null && <p role="alert">{error}</p>}
			{loops === null && error === null && (
				<p className="text-muted-foreground text-sm">
					Reading improvement activity…
				</p>
			)}
			{loops?.length === 0 && (
				<p className="text-muted-foreground text-sm">No active improvements.</p>
			)}
			<ul className="divide-y">
				{loops?.map((saved) => {
					const stage = saved.loop.stage;
					const round =
						"round" in stage ? stage.round.number : saved.loop.rounds.length;
					return (
						<li key={saved.id} className="flex min-w-0 flex-col gap-1 py-3">
							<span className="break-all font-medium text-sm">
								{saved.loop.contract.scenario}
							</span>
							<span className="text-muted-foreground text-xs">
								Round {round} · {stage.kind.replaceAll("-", " ")} · version{" "}
								{saved.version}
							</span>
							<a
								className="text-info text-sm underline"
								href={`#conversations/${encodeURIComponent(saved.conversation)}`}
							>
								Open owning conversation
							</a>
						</li>
					);
				})}
			</ul>
		</EvalSection>
	);
}
