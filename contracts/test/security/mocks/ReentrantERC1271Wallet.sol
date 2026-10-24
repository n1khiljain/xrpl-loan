// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @notice An ERC-1271 guarantor wallet that, while asked to validate a guaranty, tries to call back into the registry
/// with a stored payload before answering. Accepts signatures from one EOA owner.
contract ReentrantERC1271Wallet {
    address public immutable owner;
    address public target;
    bytes public payload;

    constructor(address owner_) {
        owner = owner_;
    }

    function setReentry(address target_, bytes calldata payload_) external {
        target = target_;
        payload = payload_;
    }

    /// @dev Not `view` on purpose: it makes a state-changing call, which only works if the caller does not
    /// `staticcall` it. A failed reentry reverts the validation, as a hostile wallet would want to force it through.
    function isValidSignature(bytes32 hash, bytes memory signature) external returns (bytes4) {
        if (target != address(0)) {
            (bool ok, bytes memory result) = target.call(payload);
            if (!ok) {
                assembly ("memory-safe") {
                    revert(add(result, 32), mload(result))
                }
            }
        }
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(hash, signature);
        if (err == ECDSA.RecoverError.NoError && signer == owner) return IERC1271.isValidSignature.selector;
        return 0xffffffff;
    }
}
