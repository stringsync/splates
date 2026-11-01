import { describe, expect, it } from "bun:test";
import { Tags } from "./tags";

describe("Tags", () => {
	it("reads flag values as tags or comma lists, without repeats", () => {
		expect(new Tags({ tags: null }).parse(["a, b", "a", "c-d"])).toEqual([
			"a",
			"b",
			"c-d",
		]);
		expect(() => new Tags({ tags: null }).parse(["A"])).toThrow("lowercase");
		expect(() => new Tags({ tags: null }).parse(["a_b"])).toThrow("lowercase");
	});

	it("allows any tag with no allow-list", () => {
		expect(new Tags({ tags: null }).forNew(["anything"], "")).toEqual([
			"anything",
		]);
	});

	it("names the allowed tags in refusing an unknown one", () => {
		const tags = new Tags({ tags: { allowed: ["web", "infra"] } });

		expect(() => tags.check(["db"])).toThrow("web, infra");
		expect(() => tags.check(["web"])).not.toThrow();
	});

	it("takes the tag of the folder when none is named", () => {
		const tags = new Tags({ tags: { allowed: ["web"] } });

		expect(tags.forNew([], "app/web/x")).toEqual(["web"]);
		expect(tags.forNew([], "other")).toEqual([]);
		expect(new Tags({ tags: null }).forNew([], "web")).toEqual([]);
	});

	it("requires a tag of a new task only when asked to", () => {
		const tags = new Tags({ tags: { required: true } });

		expect(() => tags.forNew([], "")).toThrow("say which tag");
		expect(tags.forNew([], "", false)).toEqual([]);
	});
});
