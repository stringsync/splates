/**
 * Share one with every ship target of a repository, so only one ships at a
 * time: a ship sets `holder` to itself while it runs.
 */
export class ShipLock {
	holder: object | null = null;
}
