/**
 * Remembers (in memory only) that the user just logged out on purpose, so the dashboard guard
 * does not add a `?next=` to the /login redirect it may still issue while the app unmounts.
 * Cleared when an auth page mounts. UX hint only; never used for access decisions.
 */
let signedOutByUser = false;

export const markSignedOutByUser = () => {
  signedOutByUser = true;
};
export const clearSignedOutByUser = () => {
  signedOutByUser = false;
};
export const wasSignedOutByUser = () => signedOutByUser;
