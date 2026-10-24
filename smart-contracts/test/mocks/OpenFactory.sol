// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {AppVault} from "../../src/AppVault.sol";
import {FatlineLaunchpad} from "../../src/FatlineLaunchpad.sol";

/// @notice Tests only: the launchpad without Fatliners (vaults for apps by salt, and coins with no egg), so the
/// vault and the onchain fee checks can be tested on their own. On Base the launchpad is the Fatliners contract.
contract OpenFactory is FatlineLaunchpad {
    address[] public apps;

    constructor(address usdc_, address clanker_, address locker_, address feeLocker_, AppVault.Tier[] memory tiers_)
        FatlineLaunchpad(Clanker(usdc_, clanker_, locker_, feeLocker_), tiers_)
    {}

    function _holderOf(uint256) internal pure override returns (address) {
        return address(0);
    }

    function _hasCoinRight(uint256) internal pure override returns (bool) {
        return false;
    }

    function _tickerOf(uint256) internal pure override returns (string memory) {
        return "";
    }

    function _genesis() internal pure override returns (uint256) {
        return 0;
    }

    function appsCount() external view returns (uint256) {
        return apps.length;
    }

    function predictVault(address creator, bytes32 salt) public view returns (address) {
        return Clones.predictDeterministicAddress(vaultImplementation, keccak256(abi.encode(creator, salt)));
    }

    function createApp(AppParams calldata p, uint256 deposit) external returns (AppVault vault) {
        vault = _create(p, keccak256(abi.encode(msg.sender, p.salt)), p.owner);
        apps.push(address(vault));
        _deposit(vault, deposit);
    }

    function launchApp(AppParams calldata p, bytes calldata deployCalldata, uint256 deposit)
        external
        payable
        returns (AppVault vault, address coin)
    {
        vault = _create(p, keccak256(abi.encode(msg.sender, p.salt)), p.owner);
        apps.push(address(vault));
        coin = _launch(vault, deployCalldata);
        _deposit(vault, deposit);
    }
}
