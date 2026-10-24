// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ITokenHook} from "./HookedToken.sol";

/// @notice An attacker contract: makes arbitrary calls as itself, and when armed makes one more call from inside a
/// token transfer hook, recording whether that reentrant call succeeded and what it returned.
contract HookActor is ITokenHook {
    address public hookTarget;
    bytes public hookPayload;
    bool public armed;
    uint256 public hookRuns;
    bool public hookSucceeded;
    bytes public hookResult;

    function arm(address target, bytes calldata payload) external {
        hookTarget = target;
        hookPayload = payload;
        armed = true;
    }

    function onTokenTransfer(address, address, uint256) external {
        if (!armed) return;
        armed = false;
        hookRuns++;
        (hookSucceeded, hookResult) = hookTarget.call(hookPayload);
    }

    /// @notice The first four bytes the reentrant call reverted with (zero when it succeeded).
    function hookError() external view returns (bytes4) {
        if (hookSucceeded || hookResult.length < 4) return bytes4(0);
        return bytes4(hookResult);
    }

    function exec(address target, bytes calldata data) external returns (bytes memory) {
        (bool ok, bytes memory result) = target.call(data);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(result, 32), mload(result))
            }
        }
        return result;
    }
}
