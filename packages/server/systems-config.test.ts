import { describe, expect, it } from "bun:test";
import { systemsSource } from "./migrate-config";

describe("systemsSource", () => {
	it("types the systems by a type-only import, with keys unquoted where they can be", () => {
		expect(
			systemsSource({
				docs: { aliases: ["the manual"], globs: ["*.md"] },
				"web-app": { globs: ["web/**"] },
			}),
		).toBe(`import type { SystemsFile } from "@stringsync/splates-server/systems";

export default {
	docs: {
		aliases: [
			"the manual"
		],
		globs: [
			"*.md"
		]
	},
	"web-app": {
		globs: [
			"web/**"
		]
	}
} satisfies SystemsFile;
`);
	});
});
