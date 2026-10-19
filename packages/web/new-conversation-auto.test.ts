import { beforeEach, expect, test } from "bun:test";
import "./testing-dom";
import { lastStartedAuto, rememberAuto } from "./new-conversation-project";

beforeEach(() => {
	localStorage.clear();
});

test("New follows Auto pick once a conversation started there", () => {
	expect(lastStartedAuto()).toBe(false);
	rememberAuto(true);
	expect(lastStartedAuto()).toBe(true);
	rememberAuto(false);
	expect(lastStartedAuto()).toBe(false);
});
