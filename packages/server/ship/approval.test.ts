import { describe, expect, it } from "bun:test";
import { awaitingApproval } from "./approval";
import { eventsText, readReleaseSteps } from "./release-steps";

const declared = (id: string, stage = "build") => ({
	type: "declared",
	id,
	name: id.toUpperCase(),
	stage,
	packages: [],
	deadlineMs: 5000,
	at: "t0",
});

describe("awaitingApproval", () => {
	const stagedEvent = (id: string, pkg: string) => ({
		type: "staged",
		id,
		name: id,
		package: pkg,
		version: "1.2.4",
		stageId: `st-${pkg}`,
		url: "https://www.npmjs.com/staged",
		at: "t2",
	});
	const lines = [
		{ ...declared("stage-one", "publish"), packages: ["one"] },
		{ ...declared("approve-one", "approve"), packages: ["one"] },
		{ type: "started", id: "stage-one", name: "S", at: "t1" },
		stagedEvent("stage-one", "one"),
		{ type: "done", id: "stage-one", name: "S", at: "t3" },
		{ type: "started", id: "approve-one", name: "A", at: "t4" },
	];

	it("lists staged packages while their approve step runs", () => {
		expect(
			awaitingApproval(readReleaseSteps(eventsText(lines))).map(
				(each) => each.stageId,
			),
		).toEqual(["st-one"]);
	});

	it("lists none once the approve step is done", () => {
		const done = { type: "done", id: "approve-one", name: "A", at: "t5" };
		expect(
			awaitingApproval(readReleaseSteps(eventsText([...lines, done]))),
		).toEqual([]);
	});
});
