// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";

/**
 * @title Escrow
 * @notice Holds USDT deposits keyed by an off-chain payment intent.
 *
 * `deposit(intentId, amount)` pulls the configured USDT from the payer and
 * records the intent so it cannot be reused. The payer is `_msgSender()`, so
 * a trusted ERC-2771 forwarder can submit the call and still attribute the
 * deposit to the investor. The T-REX token is not modified.
 *
 * Wrong-token transfers that arrive by `transfer` sit here until the owner
 * (the Safe) sweeps or refunds them. That is the exception path, not a mint.
 */
contract Escrow is ERC2771Context, Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable USDT;

    mapping(bytes32 => bool) public intentUsed;
    mapping(bytes32 => address) public intentPayer;
    mapping(bytes32 => uint256) public intentAmount;

    event Deposited(bytes32 indexed intentId, address indexed payer, uint256 amount, address token);
    event Refunded(bytes32 indexed intentId, address indexed to, uint256 amount);
    event Swept(address indexed token, address indexed to, uint256 amount);

    error ZeroAddress();
    error ZeroAmount();
    error IntentAlreadyUsed(bytes32 intentId);
    error UnknownIntent(bytes32 intentId);

    constructor(address usdt_, address owner_, address trustedForwarder) ERC2771Context(trustedForwarder) {
        if (usdt_ == address(0) || owner_ == address(0)) {
            revert ZeroAddress();
        }
        USDT = IERC20(usdt_);
        _transferOwnership(owner_);
    }

    function deposit(bytes32 intentId, uint256 amount) external {
        if (amount == 0) {
            revert ZeroAmount();
        }
        if (intentUsed[intentId]) {
            revert IntentAlreadyUsed(intentId);
        }

        address payer = _msgSender();
        intentUsed[intentId] = true;
        intentPayer[intentId] = payer;
        intentAmount[intentId] = amount;

        USDT.safeTransferFrom(payer, address(this), amount);
        emit Deposited(intentId, payer, amount, address(USDT));
    }

    function refund(bytes32 intentId, address to, uint256 amount) external onlyOwner {
        if (to == address(0)) {
            revert ZeroAddress();
        }
        if (amount == 0) {
            revert ZeroAmount();
        }
        if (!intentUsed[intentId]) {
            revert UnknownIntent(intentId);
        }
        USDT.safeTransfer(to, amount);
        emit Refunded(intentId, to, amount);
    }

    function sweep(address token, address to, uint256 amount) external onlyOwner {
        if (token == address(0) || to == address(0)) {
            revert ZeroAddress();
        }
        if (amount == 0) {
            revert ZeroAmount();
        }
        IERC20(token).safeTransfer(to, amount);
        emit Swept(token, to, amount);
    }

    function _msgSender() internal view override(Context, ERC2771Context) returns (address) {
        return ERC2771Context._msgSender();
    }

    function _msgData() internal view override(Context, ERC2771Context) returns (bytes calldata) {
        return ERC2771Context._msgData();
    }

    function _contextSuffixLength() internal view override(Context, ERC2771Context) returns (uint256) {
        return ERC2771Context._contextSuffixLength();
    }
}
