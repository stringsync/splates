import { describe, expect, test } from "bun:test";
import { NetworkSummary, redactUrl } from "./network";

const START = Date.parse("2026-11-03T12:00:00.000Z");

describe("network", () => {
	test("query values and fragments are dropped, keys kept", () => {
		expect(redactUrl("http://a.test/x/y?token=abc&q=1#frag")).toBe(
			"a.test/x/y?token=_&q=_",
		);
	});

	test("one line per request, with no headers or bodies", () => {
		const net = new NetworkSummary();
		net.receive("Network.requestWillBeSent", {
			requestId: "1",
			wallTime: START / 1000,
			timestamp: 100,
			request: {
				method: "POST",
				url: "http://a.test/save?id=7",
				headers: { authorization: "Bearer x" },
				postData: "secret",
			},
		});
		net.receive("Network.responseReceived", {
			requestId: "1",
			response: { status: 500, mimeType: "application/json" },
		});
		const line = net.receive("Network.loadingFinished", {
			requestId: "1",
			timestamp: 100.25,
			encodedDataLength: 2048,
		});
		expect(line).toBe(
			"2026-11-03T12:00:00.000Z ERROR POST a.test/save?id=_ 500 250ms 2.0kB application/json",
		);
		expect(line).not.toContain("secret");
	});

	test("a failed request says why", () => {
		const net = new NetworkSummary();
		net.receive("Network.requestWillBeSent", {
			requestId: "2",
			wallTime: START / 1000,
			timestamp: 1,
			request: { method: "GET", url: "http://a.test/" },
		});
		expect(
			net.receive("Network.loadingFailed", {
				requestId: "2",
				timestamp: 1.1,
				errorText: "net::ERR_CONNECTION_REFUSED",
			}),
		).toContain("net::ERR_CONNECTION_REFUSED");
	});
});
