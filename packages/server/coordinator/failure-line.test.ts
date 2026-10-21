import { describe, expect, it } from "bun:test";
import { failureLine } from "./box";

describe("failureLine", () => {
	it("names the resource that failed, not the run's own update failed", () => {
		const stdout = [
			"Updating (prod)",
			"Diagnostics:",
			"  cloudflare:index:ZeroTrustAccessServiceToken (splates-service-token):",
			'    error: [ERROR] POST "https://api.cloudflare.com/client/v4/accounts/a1/access/service_tokens": 403 Forbidden {',
			'      "success": false,',
			"    }",
			"    : failed to make http request",
			"",
			"  pulumi:pulumi:Stack (splates-prod):",
			"    error: update failed",
			"",
		].join("\n");

		expect(failureLine(`${stdout}\nerror: update failed\n`)).toBe(
			'cloudflare:index:ZeroTrustAccessServiceToken (splates-service-token): [ERROR] POST "https://api.cloudflare.com/client/v4/accounts/a1/access/service_tokens": 403 Forbidden',
		);
	});

	it("keeps the causes an error goes on to list", () => {
		const stdout = [
			"Diagnostics:",
			"  pulumi:providers:github (keys-acme):",
			"    error: Preview failed: configure provider 'keys-acme': 1 error occurred:",
			'    \t* failed to lookup organization "acme": GET https://api.github.com/orgs/acme: 401 Bad credentials []',
			"  pulumi:pulumi:Stack (splates-prod):",
			"    error: preview failed",
		].join("\n");

		expect(failureLine(stdout)).toBe(
			`pulumi:providers:github (keys-acme): Preview failed: configure provider 'keys-acme': 1 error occurred: * failed to lookup organization "acme": GET https://api.github.com/orgs/acme: 401 Bad credentials []`,
		);
	});

	it("falls back to the last error, then the last line", () => {
		expect(failureLine("Previewing\nerror: preview failed\n")).toBe(
			"error: preview failed",
		);
		expect(failureLine("error: no stack named 'prod' found\n")).toBe(
			"error: no stack named 'prod' found",
		);
		expect(failureLine("something broke\n\n")).toBe("something broke");
	});
});
