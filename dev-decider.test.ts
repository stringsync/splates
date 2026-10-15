import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { ClefDecider, JevDecider } from "webappwiz/decide";
import {
	CLOUDFLARE_ACCOUNT,
	CLOUDFLARE_TOKEN,
	credsFor,
	deciderFor,
	TYPESAFE_KEY,
} from "./dev-decider";
import { Testing } from "./testing";

describe("deciderFor", () => {
	let deps: Testing;
	beforeEach(async () => {
		deps = await Testing.open();
	});
	afterEach(() => deps.disposeAsync());

	it("names the creds each model needs", () => {
		expect(credsFor("jev-latest")).toEqual([TYPESAFE_KEY]);
		expect(credsFor("clef-flash")).toEqual([
			CLOUDFLARE_ACCOUNT,
			CLOUDFLARE_TOKEN,
		]);
	});

	it("requests every missing cred once and decides with nothing", async () => {
		let ticks = 0;
		const decider = await deciderFor(deps, undefined, async () => {
			ticks++;
		});
		expect(decider).toBeNull();
		expect(ticks).toBe(1);
		const requested = (await deps.creds.requests()).map(({ name }) => name);
		expect(requested.sort()).toEqual(
			[CLOUDFLARE_ACCOUNT, CLOUDFLARE_TOKEN].sort(),
		);
	});

	it("builds the decider for the model once its creds are kept", async () => {
		await deps.creds.save(TYPESAFE_KEY, "k", { scope: "device" });
		expect(await deciderFor(deps, "jev-latest", async () => {})).toBeInstanceOf(
			JevDecider,
		);
		await deps.creds.save(CLOUDFLARE_ACCOUNT, "a", { scope: "device" });
		await deps.creds.save(CLOUDFLARE_TOKEN, "t", { scope: "device" });
		expect(await deciderFor(deps, "clef", async () => {})).toBeInstanceOf(
			ClefDecider,
		);
	});
});
