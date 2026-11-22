import { expect, test } from "bun:test";
import { D2Draw } from "./d2-draw";

test("does nothing when disposed unused", () => {
	expect(() => new D2Draw().dispose()).not.toThrow();
});
