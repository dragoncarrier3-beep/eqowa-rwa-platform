/**
 * Pipeline statuses of a mint quote. Kept in a file with no imports so the
 * web app can share it: config/mint.ts pulls in ethers, which the web app
 * does not install.
 *
 * `minting` means the agent mint was claimed for this intent and possibly
 * broadcast. Only one caller can move an intent into it, so a retry or a
 * second worker cannot send the same mint twice.
 *
 * `awaiting_safe_approval` holds a large mint until the Safe owners sign off;
 * `safe_approved` releases it to the normal mint path.
 */
export type MintQuoteStatus =
  | 'quoted'
  | 'deposited'
  | 'awaiting_confirmations'
  | 'awaiting_safe_approval'
  | 'safe_approved'
  | 'minting'
  | 'minted'
  | 'expired'
  | 'rejected';
