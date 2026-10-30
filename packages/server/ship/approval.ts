import type { Ship, ShipWait } from "./record";
import type { ReleaseStep, StagedPackage } from "./release-steps";

/**
 * The staged packages whose approval the release still waits on: those with
 * an approve step that has not ended.
 */
export function awaitingApproval(steps: ReleaseStep[]): StagedPackage[] {
	const approving = steps.filter(
		(step) =>
			step.stage === "approve" &&
			(step.state === "pending" || step.state === "running"),
	);
	return steps
		.flatMap((step) => step.staged)
		.filter((each) =>
			approving.some(
				(step) =>
					step.packages.length === 0 || step.packages.includes(each.package),
			),
		);
}

/**
 * What the ship's record changes to as the release's `steps` stand, or null
 * for no change: the wait on the person to approve `packages`, or none once
 * they are approved.
 */
export function approvalChange(
	waiting: Ship["waiting"],
	steps: ReleaseStep[],
	now: string,
): { waiting: ShipWait | null } | null {
	const packages = awaitingApproval(steps);
	const current = waiting?.kind === "approve" ? waiting : null;
	if (packages.length === 0) {
		return current === null ? null : { waiting: null };
	}
	const ids = (list: StagedPackage[] | undefined) =>
		(list ?? []).map((each) => each.stageId).join();
	if (current !== null && ids(current.packages) === ids(packages)) {
		return null;
	}
	return {
		waiting: {
			kind: "approve",
			url: packages[0]?.url ?? "",
			since: current?.since ?? now,
			packages,
		},
	};
}
