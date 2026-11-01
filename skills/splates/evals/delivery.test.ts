import { expect, it } from "bun:test";
import { deliveredImages } from "./delivery";

it("requires inline image Markdown, accepting attach's angle-bracket paths", () => {
	expect(deliveredImages("![capture](</stored/a b.png>)")).toEqual([
		"/stored/a b.png",
	]);
	expect(deliveredImages("![capture](/stored/a.png)")).toEqual([
		"/stored/a.png",
	]);
	expect(
		deliveredImages(
			"[capture](/stored/a.png)\n/stored/a.png\n```md\n![capture](/stored/a.png)\n```",
		),
	).toEqual([]);
});
