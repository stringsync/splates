import { describe, expect, it } from "bun:test";
import {
	groomReference,
	idleReference,
	isUpdate,
	MERGE,
	reportReference,
	todoReference,
} from "./prompts";

describe("isUpdate", () => {
	it("knows splates's own updates", () => {
		expect(
			[
				reportReference("header"),
				idleReference("header"),
				groomReference(12),
			].map(isUpdate),
		).toEqual([true, true, true]);
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
