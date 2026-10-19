import { describe, expect, it } from "bun:test";
import {
	groomReference,
	idleReference,
	isUpdate,
	MERGE,
	reportReference,
	taskNumberReference,
} from "./prompts";

describe("isUpdate", () => {
	it("knows splates's own updates", () => {
		expect(
			[
				reportReference("header"),
				idleReference("header"),
				groomReference(12),
				"[SPLATES TODO DONE #12]",
			].map(isUpdate),
		).toEqual([true, true, true, true]);
	});

	it("takes what the person sends for theirs", () => {
		expect(
			[
				MERGE,
				taskNumberReference(12),
				`${reportReference("header")} and the footer`,
				"> **Which pages need it?**\n\n- (a) Tasks",
			].map(isUpdate),
		).toEqual([false, false, false, false]);
	});
});
