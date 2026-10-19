import "./register-dom";
import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { Splash } from "./splash";

afterEach(cleanup);

describe("Splash", () => {
	it("covers the page while shown", () => {
		const page = render(<Splash shown />);

		const splash = page.getByText("🍽️");
		expect(splash.className).toContain("fixed inset-0");
		expect(splash.className).not.toContain("opacity-0");
	});

	it("fades once no longer shown, and leaves when the fade ends", () => {
		const page = render(<Splash shown />);

		page.rerender(<Splash shown={false} />);
		const splash = page.getByText("🍽️");
		expect(splash.className).toContain("opacity-0");
		fireEvent.transitionEnd(splash);

		expect(page.queryByText("🍽️")).toBeNull();
	});

	it("covers the page again at once when shown again", () => {
		const page = render(<Splash shown={false} />);
		expect(page.queryByText("🍽️")).toBeNull();

		page.rerender(<Splash shown />);

		expect(page.getByText("🍽️").className).not.toContain("opacity-0");
	});
});
