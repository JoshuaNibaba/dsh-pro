/**
 * Theme pack, node half. The empty apply keeps the plugin a Loader entry; the
 * browser half owns the token layer and the Settings row through
 * exports["./client"], discovered from the package.json dsh.client declaration.
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
export function apply(): void {}
