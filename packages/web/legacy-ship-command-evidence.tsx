import type { ShipProject } from "@splates/server/legacy-ship";
import type { ReactNode } from "react";

/** Show the current script identity, shortening commit hashes for the card. */
export function CommandCurrentIdentity({
	project: each,
}: {
	project: ShipProject;
}): ReactNode {
	return (
		<>
			{(each.commandPlan?.identity.from ?? each.version) !== null && (
				<span className="text-muted-foreground text-xs tabular-nums">
					{each.commandPlan?.identity.kind === "commit"
						? each.commandPlan.identity.from?.slice(0, 9)
						: (each.commandPlan?.identity.from ?? each.version)}
				</span>
			)}
		</>
	);
}

/** Show each artifact's reported live identity beside the target. */
export function CommandLiveEvidence({
	project: each,
}: {
	project: ShipProject;
}): ReactNode {
	return (
		<>
			{each.commandStatus !== undefined && (
				<p className="text-muted-foreground text-xs">
					{each.commandStatus.artifacts
						.map(
							(artifact) =>
								`${artifact.name}: ${artifact.deployed === null ? "not live" : each.commandStatus?.identity.kind === "commit" ? artifact.deployed.slice(0, 9) : artifact.deployed}`,
						)
						.join(" · ")}
				</p>
			)}
		</>
	);
}
