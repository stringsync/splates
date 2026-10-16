import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { FakeFs } from "webappwiz/system/testing";
import { SavedTunnel, TUNNEL_TOKEN } from "./saved-tunnel";
import { Setup, type SetupMachine } from "./setup";
import { SETUP_AREAS } from "./setup-areas";
import { API_TOKEN } from "./tunnel-setup";

const HOME = "/home/.arbor";

describe("the access setup step", () => {
	let machine: SetupMachine;
	let asked: { url: string; redirect?: RequestRedirect }[];
	let answer: () => Promise<Response>;

	beforeEach(async () => {
		asked = [];
		machine = {
			fs: new FakeFs(),
			home: HOME,
			device: new FakeSecretStore(),
			fetch: (async (url: string, init?: RequestInit) => {
				asked.push({ url, redirect: init?.redirect });
				return answer();
			}) as unknown as typeof fetch,
		};
		await machine.fs.mkdir(HOME, { recursive: true });
		await new SavedTunnel(`${HOME}/tunnel.json`, {
			fs: machine.fs,
			store: machine.device,
		}).save({ host: "arbor.example.com", team: "crew", aud: "a", tunnel: "i" });
		await machine.device.set(TUNNEL_TOKEN, "token");
		await machine.device.set(API_TOKEN, "api");
	});

	async function access() {
		const progress = await new Setup(machine, SETUP_AREAS).read();
		return progress.areas
			.flatMap((area) => area.steps)
			.find((step) => step.id === "access");
	}

	it("is done when the host sends a stranger to the team's Access login", async () => {
		answer = async () =>
			new Response(null, {
				status: 302,
				headers: {
					location: "https://crew.cloudflareaccess.com/cdn-cgi/access/login",
				},
			});

		expect((await access())?.status).toBe("done");
		expect(asked).toEqual([
			{ url: "https://arbor.example.com/", redirect: "manual" },
		]);
	});

	it("says Access is missing when the host serves the page to anyone", async () => {
		answer = async () => new Response("<html>", { status: 200 });

		const step = await access();

		expect(step?.status).not.toBe("done");
		expect(step?.problem).toContain("Access is not in front of it");
	});

	it("says the host did not answer when the request fails", async () => {
		answer = async () => {
			throw new Error("getaddrinfo ENOTFOUND");
		};

		expect((await access())?.problem).toContain(
			"https://arbor.example.com did not answer: getaddrinfo ENOTFOUND",
		);
	});

	it("is left to do while the host redirects anywhere else", async () => {
		answer = async () =>
			new Response(null, {
				status: 302,
				headers: { location: "https://elsewhere.example.com/" },
			});

		const step = await access();

		expect(step?.status).toBe("ready");
		expect(step?.problem).toBeNull();
	});
});
