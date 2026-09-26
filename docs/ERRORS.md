# Revert codes and messages

Every contract revert the platform can hit is mapped to a stable code and a
sentence a person can act on, in `config/errors.ts`. `decodeRevert(error)`
takes an ethers error and returns `{ code, message, source, raw }`.

- The API stores the code and message on `mint_failed` exceptions, so the ops
  queue reads "The receiving wallet has no verified identity" rather than a raw
  revert.
- The portals (Milestone 4) show the message and branch on the code.
- An error that matches nothing keeps its own text under `reverted`, so nothing
  is hidden.

First-party contracts revert with custom errors. Vendored T-REX and
OpenZeppelin revert with strings, matched exactly. `test/config/errors.test.ts`
reads every compiled first-party contract and fails if a custom error has no
entry, so a new error cannot ship without a message.

## Custom errors (first-party contracts)

| Code | When |
| --- | --- |
| `zero_address` | A required address is missing |
| `zero_amount` | Amount of zero |
| `intent_already_used` | An escrow payment reference used twice |
| `unknown_intent` | Refund for a payment reference with no deposit |
| `compliance_already_bound`, `compliance_not_bound`, `not_compliance` | Module wiring, admin only |
| `max_balance_exceeded` | Above 150,000 shares per identity |
| `identity_not_found` | Wallet not linked to an identity |
| `country_already_allowed`, `country_not_allowed` | Allow-list changes and checks |
| `daily_mint_cap_exceeded` | Above 250,000 shares in 24 hours |
| `max_holders_exceeded` | Above 500 holders |
| `amount_too_large` | Amount beyond what a ledger can record |

## Reason strings (T-REX and OpenZeppelin)

| Code | Reason string |
| --- | --- |
| `identity_not_verified` | `Identity is not verified.` |
| `transfer_not_compliant` | `Transfer not possible` |
| `mint_not_compliant` | `Compliance not followed` |
| `insufficient_balance` | `Insufficient Balance` |
| `amount_frozen` | `Amount exceeds available balance` |
| `wallet_frozen` | `wallet is frozen` |
| `token_paused` | `Pausable: paused` |
| `not_agent` | `AgentRole: caller does not have the Agent role` |
| `not_owner` | `Ownable: caller is not the owner` |
| `recovery_not_possible` | `Recovery not possible` |
| `insufficient_allowance` | `ERC20: insufficient allowance` |
| `insufficient_usdt` | `ERC20: transfer amount exceeds balance` |

T-REX checks compliance modules as a single yes or no, so a transfer or mint
blocked by the country, balance, holder, lock-up or daily rule surfaces as
`transfer_not_compliant` or `mint_not_compliant`. To say which rule, the portal
can call each module's `moduleCheck` view, as the simulation does in step S21.
