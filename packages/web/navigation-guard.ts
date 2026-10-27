export type NavigationGuard = (proceed: () => void) => boolean;

interface Registered {
	guard: NavigationGuard;
	active: boolean;
}

let current: Registered | null = null;

/** Runs `proceed` now, or lets the current guard hold it for confirmation. */
export function attemptNavigation(proceed: () => void): boolean {
	const run = () => {
		const registration = current;
		current = null;
		try {
			proceed();
		} finally {
			if (registration?.active && current === null) {
				current = registration;
			}
		}
	};
	if (current !== null && !current.guard(run)) {
		return false;
	}
	run();
	return true;
}

/** Sets the guard held until the returned stop, restoring the one before. */
export function guardNavigation(guard: NavigationGuard): () => void {
	const before = current;
	const registration: Registered = { guard, active: true };
	current = registration;
	return () => {
		registration.active = false;
		if (current === registration) {
			current = before;
		}
	};
}
