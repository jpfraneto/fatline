// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice ERC-20 transfers that also work with tokens that return nothing.
library SafeToken {
    error TransferFailed();

    function safeTransfer(address token, address to, uint256 amount) internal {
        _call(token, abi.encodeWithSignature("transfer(address,uint256)", to, amount));
    }

    function safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        _call(token, abi.encodeWithSignature("transferFrom(address,address,uint256)", from, to, amount));
    }

    function _call(address token, bytes memory data) private {
        if (token.code.length == 0) revert TransferFailed();
        (bool ok, bytes memory ret) = token.call(data);
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
    }
}
