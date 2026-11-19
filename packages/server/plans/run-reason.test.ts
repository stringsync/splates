import { expect, test } from "bun:test";
import { permissionOf } from "./permission";

const TITLE = "## 🔐 Permission: run command: build the web app";

test("a run-command card's Reason line is read and kept out of its body", () => {
	const card = permissionOf(
		TITLE,
		"`bun run build`\n\nReason: busy\n\nAsking because the machine is busy.",
	);
	expect(card?.reason).toBe("busy");
	expect(card?.body).toBe("Asking because the machine is busy.");
});

test("a card with no Reason line has no reason", () => {
	expect(
		permissionOf(TITLE, "`bun run build`\n\nBusy.")?.reason,
	).toBeUndefined();
});

test("two Reason lines promise nothing", () => {
	const card = permissionOf(
		TITLE,
		"`rm -rf dist`\n\nReason: busy\nReason: risk\n\nWhy.",
	);
	expect(card?.reason).toBeUndefined();
});

test("a risky reason is kept as written", () => {
	expect(permissionOf(TITLE, "`aws deploy`\n\nReason: risk")?.reason).toBe(
		"risk",
	);
});
