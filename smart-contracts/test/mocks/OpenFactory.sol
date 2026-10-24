// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AppFactory} from "../../src/AppFactory.sol";
import {AppVault} from "../../src/AppVault.sol";

/// @notice Tests only: the launchpad with a coin launch that needs no Fatliner, so the vault and the
/// onchain fee checks can be tested on their own. The real launchpad launches coins only for Fatliners.
contract OpenFactory is AppFactory {
    constructor(address usdc_, address clanker_, address locker_, address feeLocker_, AppVault.Tier[] memory tiers_)
        AppFactory(usdc_, clanker_, locker_, feeLocker_, tiers_)
    {}

    function launchApp(AppParams calldata p, bytes calldata deployCalldata, uint256 deposit)
        external
        payable
        returns (AppVault vault, address coin)
    {
        vault = _create(p, _salt(msg.sender, p.salt), p.owner);
        coin = _launch(vault, deployCalldata);
        _deposit(vault, deposit);
    }
}
