import { describe, expect, it } from "bun:test";
import { resolvePortsTarget } from "./start-settings";

const ACCESS = {
	issuer: "https://team.cloudflareaccess.com",
	aud: "main-aud",
};
const TUNNEL = {
	host: "spinningplates.tech",
	provider: {
		ready: async () => {},
		run: () => ({ disposeAsync: async () => {} }),
	},
};

describe("resolvePortsTarget", () => {
	it("falls back to the machine tunnel's wildcard zone and Access app when no ports host is saved", async () => {
		const resolved = await resolvePortsTarget({
			portsFlag: undefined,
			savedPortsHost: null,
			slotServer: false,
			workerless: false,
			flagged: false,
			access: ACCESS,
			tunnel: TUNNEL,
			ensureWildcard: async () => ({
				base: "spinningplates.tech",
				aud: "wildcard-aud",
			}),
		});

		expect(resolved).toEqual({
			portsHost: "spinningplates.tech",
			portsAccess: {
				issuer: ACCESS.issuer,
				aud: "wildcard-aud",
				extraAuds: ["main-aud"],
			},
		});
	});

	it("prefers an explicit --ports-host or saved ports host over wildcard fallback", async () => {
		let called = false;
		const ensureWildcard = async () => {
			called = true;
			return { base: "spinningplates.tech", aud: "wildcard-aud" };
		};

		expect(
			await resolvePortsTarget({
				portsFlag: "ports.example.com",
				savedPortsHost: null,
				slotServer: false,
				workerless: false,
				flagged: false,
				access: ACCESS,
				tunnel: TUNNEL,
				ensureWildcard,
			}),
		).toEqual({ portsHost: "ports.example.com", portsAccess: null });

		expect(
			await resolvePortsTarget({
				portsFlag: undefined,
				savedPortsHost: "saved.example.com",
				slotServer: false,
				workerless: false,
				flagged: false,
				access: ACCESS,
				tunnel: TUNNEL,
				ensureWildcard,
			}),
		).toEqual({ portsHost: "saved.example.com", portsAccess: null });
		expect(called).toBe(false);
	});

	it("disables wildcard fallback for --ports-host none, slot servers, and workerless or flagged servers", async () => {
		let called = false;
		const ensureWildcard = async () => {
			called = true;
			return { base: "spinningplates.tech", aud: "wildcard-aud" };
		};

		const results = await Promise.all(
			[
				{ portsFlag: null as string | null },
				{ slotServer: true },
				{ workerless: true },
				{ flagged: true },
			].map((overrides) =>
				resolvePortsTarget({
					portsFlag: undefined,
					savedPortsHost: null,
					slotServer: false,
					workerless: false,
					flagged: false,
					access: ACCESS,
					tunnel: TUNNEL,
					ensureWildcard,
					...overrides,
				}),
			),
		);
		expect(results).toEqual([
			{ portsHost: null, portsAccess: null },
			{ portsHost: null, portsAccess: null },
			{ portsHost: null, portsAccess: null },
			{ portsHost: null, portsAccess: null },
		]);
		expect(called).toBe(false);
	});
});
