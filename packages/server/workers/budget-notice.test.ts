import { describe, expect, it } from "bun:test";
import { alertNotice, dollars } from "./budget-notice";

describe("budget notices", () => {
	it("says the limit reached and what to do", () => {
		const notice = alertNotice({
			standing: {
				limit: "day",
				window: "today",
				since: 0,
				dollars: 5,
				raised: 0,
				set: false,
				spent: 6,
				left: 0,
				tier: 100,
				estimate: true,
			},
			tier: 100,
		});

		expect(notice.title).toBe("Workers: today's $5.00 reached");
		expect(notice.body).toContain("splates budget raise");
	});

	it("shows cents, and a tenth of a cent only when there is one", () => {
		expect(dollars(0.25)).toBe("$0.25");
		expect(dollars(0.05)).toBe("$0.05");
		expect(dollars(0.0125)).toBe("$0.013");
		expect(dollars(75)).toBe("$75.00");
	});
});
