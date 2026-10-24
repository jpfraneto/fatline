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
///     GENESIS_STONE    its stone, read from that history (0 ivory … 6 opal; Aster: 5, gold)
contract Deploy is Script {
    // Base mainnet (chain 8453)
    address public constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address public constant CLANKER = 0xE85A59c628F7d27878ACeB4bf3b35733630083a9;
    address public constant LOCKER = 0xffA37784D619F228D8B379d287a4D7282e500762; // LP locker v1.1 used by clanker-sdk 4.2.19
    address public constant FEE_LOCKER = 0xF3622742b1E446D92e45E22923Ef11C2fcD55D68;

    /// Compute tiers in USDC units per second. 1 unit/s = 2.592 USDC per 30 days.
    function defaultTiers() public pure returns (AppVault.Tier[] memory t) {
        t = new AppVault.Tier[](3);
        t[0] = AppVault.Tier({ratePerSecond: 50, minDau: 0}); // Node: ~4.32 USDC a day, what Aster's server costs
        t[1] = AppVault.Tier({ratePerSecond: 130, minDau: 100}); // ~11.23 USDC a day: a rented node (AgentMetal medium + disk)
        t[2] = AppVault.Tier({ratePerSecond: 300, minDau: 1_000}); // ~25.92 USDC a day: both networks, room to grow
    }

    function run() external {
        vm.startBroadcast();

        address voices;
        if (vm.envOr("VOICES", true)) {
            voices = address(new Voices());
            console.log("Voices", voices);
        }

        if (vm.envOr("FATLINERS", false)) {
            Fatliners.Genesis memory g = Fatliners.Genesis({
                server: vm.envAddress("GENESIS"),
                url: vm.envString("GENESIS_URL"),
                fid: vm.envUint("GENESIS_FID"),
                to: vm.envAddress("GENESIS_TO"),
                surname: vm.envOr("GENESIS_SURNAME", string("FATLINE")),
                dna: vm.envBytes32("GENESIS_DNA"),
                laidAt: uint64(vm.envUint("GENESIS_LAID_AT")),
                stone: uint8(vm.envOr("GENESIS_STONE", uint256(0))),
                royaltyTo: vm.envOr("ROYALTY_TO", address(0xed21735DC192dC4eeAFd71b4Dc023bC53fE4DF15)) // jpfraneto.eth
            });
            Fatliners f = new Fatliners(
                777, g, "https://fatline.ink/fatliners/", FatlineLaunchpad.Clanker(USDC, CLANKER, LOCKER, FEE_LOCKER), defaultTiers()
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
