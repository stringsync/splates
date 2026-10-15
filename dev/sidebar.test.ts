import { beforeEach, describe, expect, it } from "bun:test";
import { DEFAULT_WIDTH, MAX_WIDTH, MIN_WIDTH, Sidebar } from "./sidebar";
import "./testing";

describe("Sidebar", () => {
	beforeEach(() => localStorage.clear());

	it("starts at the default, and keeps a width once asked to", () => {
		const sidebar = new Sidebar(localStorage);
		expect(sidebar.width).toBe(DEFAULT_WIDTH);

		sidebar.set(300);
		expect(new Sidebar(localStorage).width).toBe(DEFAULT_WIDTH);
		sidebar.keep();
		expect(new Sidebar(localStorage).width).toBe(300);
	});

	it("stays within its range, however far it is dragged or what was kept", () => {
		const sidebar = new Sidebar(localStorage);
		sidebar.set(10);
		expect(sidebar.width).toBe(MIN_WIDTH);
		sidebar.set(5000);
		expect(sidebar.width).toBe(MAX_WIDTH);

		localStorage.setItem("arbor.sidebarWidth", "9999");
		expect(new Sidebar(localStorage).width).toBe(MAX_WIDTH);
		localStorage.setItem("arbor.sidebarWidth", "wide");
		expect(new Sidebar(localStorage).width).toBe(DEFAULT_WIDTH);
	});

	it("goes back to the default on reset, keeping nothing", () => {
		const sidebar = new Sidebar(localStorage);
		sidebar.set(320);
		sidebar.keep();
		sidebar.reset();
		expect(sidebar.width).toBe(DEFAULT_WIDTH);
		expect(localStorage.getItem("arbor.sidebarWidth")).toBeNull();
	});

	it("hides and shows again, keeping a hidden one hidden", () => {
		const sidebar = new Sidebar(localStorage);
		expect(sidebar.shown).toBe(true);

		sidebar.toggle();
		expect(sidebar.shown).toBe(false);
		expect(new Sidebar(localStorage).shown).toBe(false);
		sidebar.toggle();
		expect(new Sidebar(localStorage).shown).toBe(true);
		expect(new Sidebar().shown).toBe(true);
	});
});
