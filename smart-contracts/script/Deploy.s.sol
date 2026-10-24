// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {Voices} from "../src/Voices.sol";
import {AppVault} from "../src/AppVault.sol";
import {PrizeSplit} from "../src/PrizeSplit.sol";
import {Fatliners} from "../src/Fatliners.sol";
import {FatlineLaunchpad} from "../src/FatlineLaunchpad.sol";

/// Deploys the Fatline contracts.
///
///   VOICES=true                  deploy Voices (default true)
///   SPLIT_A=0x... SPLIT_B=0x...  deploy a 50/50 PrizeSplit
///   FATLINERS=true               deploy Fatliners: the eggs, the 777, and the launchpad (one contract). Needs:
///     GENESIS          the genesis server's hatchery key (the first attester)
///     GENESIS_URL      where its hatchery answers
///     GENESIS_FID      the genesis Fatliner (Aster: 18350), born at deployment
///     GENESIS_TO       who it is born to
///     GENESIS_SURNAME  its surname and its coin's ticker (default FATLINE)
///     GENESIS_DNA      its history commitment, GENESIS_LAID_AT its cutoff (unix seconds)
contract Deploy is Script {
    // Base mainnet (chain 8453)
    address public constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address public constant CLANKER = 0xE85A59c628F7d27878ACeB4bf3b35733630083a9;
    address public constant LOCKER = 0xffA37784D619F228D8B379d287a4D7282e500762; // LP locker v1.1 used by clanker-sdk 4.2.19
    address public constant FEE_LOCKER = 0xF3622742b1E446D92e45E22923Ef11C2fcD55D68;

    /// Compute tiers in USDC units per second. 1 unit/s = 2.592 USDC per 30 days.
    function defaultTiers() public pure returns (AppVault.Tier[] memory t) {
        t = new AppVault.Tier[](3);
        t[0] = AppVault.Tier({ratePerSecond: 6, minDau: 0}); // Seed: ~15.55 USDC / 30 days, small server
        t[1] = AppVault.Tier({ratePerSecond: 18, minDau: 100}); // Grow: ~46.66 USDC / 30 days, bigger server
        t[2] = AppVault.Tier({ratePerSecond: 58, minDau: 1_000}); // Node: ~150.34 USDC / 30 days, own full node
    }

    function run() external {
        vm.startBroadcast();

        if (vm.envOr("VOICES", true)) console.log("Voices", address(new Voices()));

        if (vm.envOr("FATLINERS", false)) {
            Fatliners f = new Fatliners(
                777,
                vm.envAddress("GENESIS"),
                vm.envString("GENESIS_URL"),
                vm.envUint("GENESIS_FID"),
                vm.envAddress("GENESIS_TO"),
                vm.envOr("GENESIS_SURNAME", string("FATLINE")),
                vm.envBytes32("GENESIS_DNA"),
                uint64(vm.envUint("GENESIS_LAID_AT")),
                "https://fatline.ink/fatliners/",
                FatlineLaunchpad.Clanker(USDC, CLANKER, LOCKER, FEE_LOCKER),
                defaultTiers()
            );
            console.log("Fatliners", address(f));
            console.log("VaultImplementation", f.vaultImplementation());
        }

        address a = vm.envOr("SPLIT_A", address(0));
        address b = vm.envOr("SPLIT_B", address(0));
        if (a != address(0) && b != address(0)) console.log("PrizeSplit", address(new PrizeSplit(a, b)));

        vm.stopBroadcast();
    }
}
