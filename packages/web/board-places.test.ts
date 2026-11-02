import "./register-dom";
import { afterEach, beforeEach, expect, it } from "bun:test";
import { saveBoard, savedBoard } from "./board-places";
import { knowFocused, projectUrl } from "./project-places";

beforeEach(() => {
	(
		window as unknown as { happyDOM: { setURL(url: string): void } }
	).happyDOM.setURL("http://localhost/");
	localStorage.clear();
	knowFocused("alpha");
	history.replaceState(null, "", "/");
});
afterEach(() => {
	localStorage.clear();
	history.replaceState(null, "", "/");
});

it("remembers boards independently for each project and leaves query state behind when switching", () => {
	saveBoard(2);
	history.replaceState(null, "", projectUrl({ slug: "beta" }));
	expect(savedBoard()).toBeNull();
	saveBoard(7);
	history.replaceState(null, "", projectUrl({ slug: "alpha" }));
	expect(savedBoard()).toBe(2);
	history.replaceState(null, "", projectUrl({ slug: "beta" }));
	expect(savedBoard()).toBe(7);
});

it("honors an explicit board link before the remembered selection", () => {
	saveBoard(2);
	history.replaceState(null, "", "/?board=7#todos");
	expect(savedBoard()).toBe(7);
});
