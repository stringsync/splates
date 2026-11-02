import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "core/creds/testing";
import { FakeFs, FakePs } from "core/system/testing";
import { FsStorage } from "../storage";
import {
	API_TOKEN,
	SavedPortsHost,
	SavedTunnel,
	TUNNEL_TOKEN,
} from "../tunnel";
import { REMOTE_ACCESS_AREA } from "./area-remote";
import { Setup, type SetupMachine } from "./setup";

const HOME = "/home/.splates";

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
		await SavedTunnel.in(
			new FsStorage(`${HOME}`, machine.fs),
			machine.device,
		).save({
			host: "splates.example.com",
			team: "crew",
			aud: "a",
			tunnel: "i",
		});
		await machine.device.set(TUNNEL_TOKEN, "token");
		await machine.device.set(API_TOKEN, "api");
	});

	async function access() {
		const progress = await new Setup(machine, [REMOTE_ACCESS_AREA]).read();
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
		expect(asked.filter((each) => each.redirect === "manual")).toEqual([
			{ url: "https://splates.example.com/", redirect: "manual" },
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
			"https://splates.example.com did not answer: getaddrinfo ENOTFOUND",
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

	it("checks the ports host against the base `--ports-host` saved", async () => {
		const step = REMOTE_ACCESS_AREA.steps.find(
			(step) => step.id === "ports-host",
		);

		expect(await step?.check(machine)).toBe(false);
		await SavedPortsHost.in(new FsStorage(`${HOME}`, machine.fs)).save(
			"ports.example.com",
		);
		expect(await step?.check(machine)).toBe(true);
	});

	it("saves the ports host Next is given, and refuses a bad one", async () => {
		answer = async () =>
			new Response(null, {
				status: 302,
				headers: {
					location: "https://crew.cloudflareaccess.com/cdn-cgi/access/login",
				},
			});
		const setup = new Setup(machine, [REMOTE_ACCESS_AREA]);

		await expect(setup.submit("ports-host", { base: "nope" })).rejects.toThrow(
			"invalid ports host",
		);
		const progress = await setup.submit("ports-host", {
			base: "*.Ports.example.com",
		});

		expect(
			await SavedPortsHost.in(new FsStorage(`${HOME}`, machine.fs)).read(),
		).toBe("ports.example.com");
		expect(
			progress.areas[0]?.steps.find((step) => step.id === "ports-host")?.status,
		).toBe("done");
	});

	it("is done with cloudflared once it answers --version", async () => {
		const step = REMOTE_ACCESS_AREA.steps.find(
			(each) => each.id === "cloudflared",
		);
		const missing = new CloudflaredPs(127);
		const installed = new CloudflaredPs(0);

		expect(await step?.check({ ...machine, ps: missing })).toBe(false);
		expect(await step?.check({ ...machine, ps: installed })).toBe(true);
		expect(await step?.found?.({ ...machine, ps: installed })).toContain(
			"2025.1.0",
		);
	});

	it("is done with the domain once the token sees a zone of the account", async () => {
		const step = REMOTE_ACCESS_AREA.steps.find(
			(each) => each.id === "cloudflare-domain",
		);
		const zones: unknown[] = [];
		const seen = {
			...machine,
			fetch: (async () =>
				Response.json({
					success: true,
					result: zones,
					result_info: { total_pages: 1 },
				})) as unknown as typeof fetch,
		};

		expect(await step?.check(seen)).toBe(false);
		zones.push({ name: "example.com" });
		expect(await step?.check(seen)).toBe(true);
		expect(await step?.found?.(seen)).toContain("example.com");
	});

	it("has no page for slot tunnels", () => {
		expect(REMOTE_ACCESS_AREA.steps.map((step) => step.id)).toEqual([
			"cloudflared",
			"cloudflare-token",
			"cloudflare-domain",
			"tunnel",
			"access",
			"ports-host",
		]);
	});
});

/** A machine whose `cloudflared --version` exits `code`, printing its version at 0. */
class CloudflaredPs extends FakePs {
	constructor(private readonly code: number) {
		super();
	}

	override async spawnCapture() {
		return {
			exitCode: this.code,
			stdout: this.code === 0 ? "cloudflared version 2025.1.0\n" : "",
			stderr: "",
		};
	}
}
