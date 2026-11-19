import { expect, it } from "bun:test";
import { PageKill } from "./page-kill";

const store = () => {
	const kept = new Map<string, string>();
	return {
		getItem: (key: string) => kept.get(key) ?? null,
		setItem: (key: string, value: string) => void kept.set(key, value),
	};
};

it("reports a page that was in front and never closed, and no other ending", () => {
	const storage = store();
	expect(new PageKill(storage, "phone").start()).toBeNull();

	const first = new PageKill(storage, "phone");
	first.open("c1", 900);
	const killed = new PageKill(storage, "phone").start();
	expect(killed).toEqual({ conversation: "c1", messages: 900, agent: "phone" });

	const second = new PageKill(storage, "phone");
	second.start();
	second.become("hidden");
	expect(new PageKill(storage, "phone").start()).toBeNull();

	const third = new PageKill(storage, "phone");
	third.start();
	third.become("ended");
	expect(new PageKill(storage, "phone").start()).toBeNull();
});
