/** Chain this deployment runs on. Kept apart from lib/wagmi so plain components need no wallet code. */
export const APP_CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 80002);
