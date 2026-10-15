import { describe, expect, it } from "bun:test";
import {
	HEARTBEAT,
	idleReference,
	isUpdate,
	MERGE,
	reportReference,
	stoppedReference,
	todoReference,
} from "./prompts";

describe("isUpdate", () => {
	it("knows arbor's own updates", () => {
		expect(
			[
				reportReference("header"),
				idleReference("header"),
				stoppedReference("header"),
				HEARTBEAT,
			].map(isUpdate),
		).toEqual([true, true, true, true]);
	});

	it("takes what the person sends for theirs", () => {
		expect(
			[
				MERGE,
				todoReference(12),
				`${reportReference("header")} and the footer`,
				"> **Which pages need it?**\n\n- (a) Todos",
			].map(isUpdate),
		).toEqual([false, false, false, false]);
	});
});
