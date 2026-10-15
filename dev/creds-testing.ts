import { expect } from "bun:test";
import type { CredRequest } from "../creds";
import { act, fireEvent, type Testing, waitFor } from "./testing";

/** A request for a cred kept for every project, from task alpha. */
export const REQUEST: CredRequest = {
	name: "CLOUDFLARE_TOKEN",
	scope: "device",
	purpose: "To route `arbor.example.com` to `arbor dev`.",
	instructions: "Open **API Tokens** and create one.",
	task: "alpha",
	status: "open",
	requestedAt: "2026-10-14T12:00:00.000Z",
};

/**
 * Pastes `value` into `field` and saves it, then checks it went nowhere but
 * the one write to its store: a hidden field, emptied or gone once saved, with the
 * value in no other write, no storage and nothing on the page. Each field
 * says the value stays private.
 */
export async function pasteAndSave(
	testing: Testing,
	field: HTMLElement,
	value: string,
): Promise<void> {
	const input = field as HTMLInputElement;
	expect(input.type).toBe("password");
	expect(input.autocomplete).toBe("off");
	const form = input.closest("form");
	if (form === null) {
		throw new Error("the field is in no form");
	}
	expect(form.textContent).toContain(
		"Private: the agent never sees it, and it is kept encrypted. Learn more",
	);
	fireEvent.change(input, { target: { value } });
	await act(async () => fireEvent.submit(form));

	await waitFor(() => expect(input.isConnected ? input.value : "").toBe(""));
	const carrying = testing.posts.filter((each) =>
		JSON.stringify(each.body ?? "").includes(value),
	);
	expect(carrying.map((each) => [each.method, each.path])).toEqual([
		["PUT", expect.stringMatching(/^\/api\/creds\/[A-Z_]+$/)],
	]);
	expect(JSON.stringify({ ...localStorage })).not.toContain(value);
	expect(JSON.stringify({ ...sessionStorage })).not.toContain(value);
	expect(document.body.innerHTML).not.toContain(value);
}
