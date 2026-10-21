// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SafeToken} from "./SafeToken.sol";

/// @title PrizeSplit
/// @notice A prize address that belongs to two people equally. Nobody can change the split.
///
/// Give this contract's address as the payout address. Send ETH or any ERC-20 here. Each person
/// claims their half whenever they want, without needing the other's permission. If one person
/// never claims, the other is not blocked.
contract PrizeSplit {
    using SafeToken for address;

    address public immutable a;
    address public immutable b;

    /// @dev token address(0) means ETH.
    mapping(address token => uint256) public totalReleased;
    mapping(address token => mapping(address payee => uint256)) public released;

    event Received(address indexed from, uint256 amount);
    event Released(address indexed token, address indexed payee, uint256 amount);

    error ZeroAddress();
    error SamePerson();
    error NotPayee();
    error NothingDue();
    error EthSendFailed();

    constructor(address a_, address b_) {
        if (a_ == address(0) || b_ == address(0)) revert ZeroAddress();
        if (a_ == b_) revert SamePerson();
        a = a_;
        b = b_;
    }

    receive() external payable {
        emit Received(msg.sender, msg.value);
    }

    /// @notice What `payee` can claim now. Use address(0) for ETH.
    function due(address token, address payee) public view returns (uint256) {
        if (payee != a && payee != b) return 0;
        uint256 balance = token == address(0) ? address(this).balance : _balanceOf(token);
        uint256 everReceived = balance + totalReleased[token];
        return everReceived / 2 - released[token][payee];
    }

    /// @notice Send `payee` their half. Anyone can call it; the money only goes to the payee.
    function release(address token, address payee) external returns (uint256 amount) {
        if (payee != a && payee != b) revert NotPayee();
        amount = due(token, payee);
        if (amount == 0) revert NothingDue();

        released[token][payee] += amount;
        totalReleased[token] += amount;

        if (token == address(0)) {
            (bool ok,) = payee.call{value: amount}("");
            if (!ok) revert EthSendFailed();
        } else {
            token.safeTransfer(payee, amount);
        }
        emit Released(token, payee, amount);
    }

    function _balanceOf(address token) private view returns (uint256) {
        (bool ok, bytes memory ret) = token.staticcall(abi.encodeWithSignature("balanceOf(address)", address(this)));
        return ok && ret.length >= 32 ? abi.decode(ret, (uint256)) : 0;
    }
}
