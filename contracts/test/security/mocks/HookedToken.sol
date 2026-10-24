// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {MockFrxUSD} from "../../../src/mocks/MockFrxUSD.sol";

/// @notice Callback a `HookedToken` makes on a transfer, like ERC-777 `tokensToSend` / `tokensReceived`.
interface ITokenHook {
    function onTokenTransfer(address from, address to, uint256 amount) external;
}

/// @notice frxUSD stand-in whose transfers call out to attacker code, to test what U-31 assumes away.
/// @dev A sender hook runs before balances move by default (ERC-777 `tokensToSend`), or after them when
/// `senderHookAfter` is set. A receiver hook always runs after balances move (ERC-777 `tokensReceived`).
/// Mints and burns call no hook. The hook address need not be the account itself, so an EOA can have one.
contract HookedToken is MockFrxUSD {
    mapping(address account => address hook) public senderHook;
    mapping(address account => address hook) public receiverHook;
    bool public senderHookAfter;

    function setSenderHook(address account, address hook) external {
        senderHook[account] = hook;
    }

    function setReceiverHook(address account, address hook) external {
        receiverHook[account] = hook;
    }

    function setSenderHookAfter(bool after_) external {
        senderHookAfter = after_;
    }

    function _update(address from, address to, uint256 value) internal override {
        bool isTransfer = from != address(0) && to != address(0);
        address sendHook = isTransfer ? senderHook[from] : address(0);
        if (sendHook != address(0) && !senderHookAfter) ITokenHook(sendHook).onTokenTransfer(from, to, value);
        super._update(from, to, value);
        if (sendHook != address(0) && senderHookAfter) ITokenHook(sendHook).onTokenTransfer(from, to, value);
        address recvHook = isTransfer ? receiverHook[to] : address(0);
        if (recvHook != address(0)) ITokenHook(recvHook).onTokenTransfer(from, to, value);
    }
}
