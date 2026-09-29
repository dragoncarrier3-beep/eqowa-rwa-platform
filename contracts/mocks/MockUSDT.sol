// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockUSDT
 * @notice 6-decimal stand-in for native Polygon USDT. Amoy has no official
 * USDT. Tests and Milestone 3 use this. Not for mainnet.
 *
 * Polygon PoS USDT (UChildERC20) accepts meta-transactions: the holder signs
 * an EIP-712 message and anyone can submit it with `executeMetaTransaction`,
 * paying the gas. Investors approve the escrow this way without holding POL.
 * This mock reproduces that interface byte for byte (domain with `salt`,
 * typehash, nonce, the `getDomainSeperator` spelling), so the relayer and the
 * web app use one code path on Amoy and mainnet.
 */
contract MockUSDT is ERC20 {
    /// Polygon's EIP712Base uses a salt equal to the chain id instead of a chainId field.
    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,address verifyingContract,bytes32 salt)");
    bytes32 private constant META_TRANSACTION_TYPEHASH =
        keccak256("MetaTransaction(uint256 nonce,address from,bytes functionSignature)");
    string public constant ERC712_VERSION = "1";

    mapping(address => uint256) private _metaNonces;

    event MetaTransactionExecuted(address userAddress, address relayerAddress, bytes functionSignature);

    constructor() ERC20("Mock USDT", "USDT") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @notice Next meta-transaction nonce of `user`.
    function getNonce(address user) external view returns (uint256) {
        return _metaNonces[user];
    }

    /// @notice EIP-712 domain separator, spelled as on Polygon PoS tokens.
    function getDomainSeperator() public view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    EIP712_DOMAIN_TYPEHASH,
                    keccak256(bytes(name())),
                    keccak256(bytes(ERC712_VERSION)),
                    address(this),
                    bytes32(block.chainid)
                )
            );
    }

    /**
     * @notice Runs `functionSignature` (calldata of a call on this token) as
     * `userAddress`, who signed it. The caller pays the gas.
     */
    function executeMetaTransaction(
        address userAddress,
        bytes calldata functionSignature,
        bytes32 sigR,
        bytes32 sigS,
        uint8 sigV
    ) external payable returns (bytes memory) {
        // Revert strings, not custom errors: they match Polygon USDT exactly, so
        // callers decode the same failure on Amoy and mainnet.
        // solhint-disable-next-line gas-custom-errors
        require(userAddress != address(0), "NativeMetaTransaction: INVALID_SIGNER");
        uint256 nonce = _metaNonces[userAddress];
        bytes32 structHash = keccak256(
            abi.encode(META_TRANSACTION_TYPEHASH, nonce, userAddress, keccak256(functionSignature))
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", getDomainSeperator(), structHash));
        // solhint-disable-next-line gas-custom-errors
        require(ecrecover(digest, sigV, sigR, sigS) == userAddress, "Signer and signature do not match");

        _metaNonces[userAddress] = nonce + 1;
        emit MetaTransactionExecuted(userAddress, msg.sender, functionSignature);

        // The signer rides along as the last 20 bytes, read back by _msgSender.
        // solhint-disable-next-line avoid-low-level-calls
        (bool success, bytes memory returnData) = address(this).call(abi.encodePacked(functionSignature, userAddress));
        // solhint-disable-next-line gas-custom-errors
        require(success, "Function call not successful");
        return returnData;
    }

    /// Self-calls from executeMetaTransaction act for the appended signer.
    function _msgSender() internal view override returns (address sender) {
        if (msg.sender == address(this) && msg.data.length >= 20) {
            // solhint-disable-next-line no-inline-assembly
            assembly {
                sender := shr(96, calldataload(sub(calldatasize(), 20)))
            }
        } else {
            sender = msg.sender;
        }
    }
}
