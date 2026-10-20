import { beforeEach, describe, expect, it } from "bun:test";
import { FakeTimer } from "webappwiz/time/testing";
import { FakePageCopies } from "./fake-page-copies";
import { PageCopy } from "./page-copy";

describe("PageCopy", () => {
	let copies: FakePageCopies;
	let timer: FakeTimer;
	let copy: PageCopy<string>;

	beforeEach(() => {
		copies = new FakePageCopies();
		timer = new FakeTimer();
		copy = new PageCopy(copies, "word", timer, "b1");
	});

	it("keeps the last value once its wait has passed, made once", async () => {
		const made: string[] = [];

		copy.keep(() => {
			made.push("first");
			return "first";
		});
		copy.keep(() => {
			made.push("last");
			return "last";
		});
		expect(await copy.load()).toBeNull();
		timer.fireTimeouts();

		expect(await copy.load()).toBe("last");
		expect(made).toEqual(["last"]);
	});

	it("keeps what is pending when disposed", async () => {
		copy.keep(() => "kept");
		copy.dispose();

		expect(await copy.load()).toBe("kept");
	});

	it("gives nothing back to another build", async () => {
		copy.keep(() => "kept");
		copy.dispose();

		expect(await new PageCopy(copies, "word", timer, "b2").load()).toBeNull();
	});
});
