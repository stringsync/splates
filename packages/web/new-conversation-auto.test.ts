import { beforeEach, expect, test } from "bun:test";
import "./testing-dom";
import {
	autoAddress,
	NEW,
	newAddress,
	rememberAuto,
	startsAuto,
} from "./conversation-address";

beforeEach(() => {
	localStorage.clear();
});

test("New follows Auto pick once a conversation started there", () => {
	expect(startsAuto(NEW)).toBe(false);
	expect(startsAuto(null)).toBe(false);
	rememberAuto(true);
	expect(startsAuto(NEW)).toBe(true);
	expect(startsAuto(null)).toBe(true);
	rememberAuto(false);
	expect(startsAuto(NEW)).toBe(false);
});

test("An address that names an agent or Auto pick keeps it", () => {
	rememberAuto(true);
	expect(startsAuto(newAddress("codex", null))).toBe(false);
	rememberAuto(false);
	expect(startsAuto(autoAddress(null))).toBe(true);
	expect(startsAuto(autoAddress("fix-upload"))).toBe(true);
});
