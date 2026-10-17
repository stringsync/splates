import { createContext } from "react";

/** Where the page goes to another address, which tests fake. */
export interface Navigation {
	/** Leaves this page for the one at `url`. */
	go(url: string): void;
}

/** The browser's own navigation, unless a provider gives another. */
export const NavigationContext = createContext<Navigation>({
	go: (url) => location.assign(url),
});
