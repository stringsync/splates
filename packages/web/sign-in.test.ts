import { beforeEach, describe, expect, test } from "bun:test";
import { SignIn } from "./sign-in";

describe("SignIn", () => {
	let kept: Map<string, string>;
	let reloads: number;
	let time: number;
	let type: string;
	let signIn: SignIn;

	beforeEach(() => {
		kept = new Map();
		reloads = 0;
		time = 1_000_000;
		type = "opaqueredirect";
		signIn = new SignIn(
			{
				getItem: (key) => kept.get(key) ?? null,
				setItem: (key, value) => void kept.set(key, value),
			},
			() => void reloads++,
			() => time,
			async () => {
				if (type === "down") {
					throw new TypeError("offline");
				}
				return { type } as Pick<Response, "type">;
			},
		);
	});

	test("reloads once Access redirects the shell to its login, not again within a minute", async () => {
		expect(await signIn.reloadIfWanted()).toBe(true);
		time += 30_000;
		expect(await signIn.reloadIfWanted()).toBe(false);
		time += 40_000;
		expect(await signIn.reloadIfWanted()).toBe(true);
		expect(reloads).toBe(2);
	});

	test("leaves the page alone when the shell answers or the network fails", async () => {
		type = "basic";
		expect(await signIn.reloadIfWanted()).toBe(false);
		type = "down";
		expect(await signIn.reloadIfWanted()).toBe(false);
		expect(reloads).toBe(0);
	});
});
