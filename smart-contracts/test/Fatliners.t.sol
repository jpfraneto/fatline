// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC721Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {AppFactory} from "../src/AppFactory.sol";
import {AppVault} from "../src/AppVault.sol";
import {Fatliners, IFatlineVaults} from "../src/Fatliners.sol";
import {IClanker} from "../src/interfaces/IClanker.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {MockClanker, MockFeeLocker, MockLocker} from "./mocks/MockClanker.sol";

contract FatlinersTest is Test {
    MockUSDC usdc;
    MockLocker locker;
    MockFeeLocker feeLocker;
    MockClanker clanker;
    AppFactory factory;
    Fatliners nft;

    // attesters[0] is the genesis server (it keeps Aster alive); attesters[1..5] join by hatching eggs.
    address[] attesters;
    uint256[] keys;
    address anky = makeAddr("anky"); // FID 18350's egg goes here
    address dwr = makeAddr("dwr"); // FID 3
    address keeper = makeAddr("keeper");
    address buyer = makeAddr("buyer");
    address aster = makeAddr("aster's keeper");

    bytes32 constant DNA = keccak256("anky's history");
    uint256 constant ASTER = 777777; // the genesis Fatliner in these tests (on Base: FID 18350)
    uint64 laidAt;

    function setUp() public {
        vm.warp(1_792_600_000); // October 2026
        laidAt = uint64(block.timestamp - 3 days);
        usdc = new MockUSDC();
        locker = new MockLocker();
        feeLocker = new MockFeeLocker();
        clanker = new MockClanker(locker, address(usdc));
        AppVault.Tier[] memory t = new AppVault.Tier[](1);
        t[0] = AppVault.Tier(30, 0); // ~2.59 USDC a day: one node's fuel
        factory = new AppFactory(address(usdc), address(clanker), address(locker), address(feeLocker), t);
        for (uint256 i; i < 6; i++) {
            (address a, uint256 k) = makeAddrAndKey(string.concat("server", vm.toString(i)));
            attesters.push(a);
            keys.push(k);
        }
        nft = genesis(777);
        factory.setFatliners(address(nft));
    }

    function genesis(uint256 max) internal returns (Fatliners) {
        return new Fatliners(
            max, attesters[0], "http://genesis:8791", ASTER, aster, "FATLINE", keccak256("aster"), laidAt,
            IFatlineVaults(address(factory)), "https://fatline.ink/fatliners/"
        );
    }

    // ------------------------------------------------------------ signing

    function anEgg(uint256 fid, address to, bytes32 dna, address server) internal view returns (Fatliners.Egg memory) {
        return Fatliners.Egg({
            fid: fid, to: to, server: server, url: string.concat("http://server-", vm.toString(fid), ":8791"),
            dna: dna, laidAt: laidAt, deadline: block.timestamp + 30 days
        });
    }

    function aHatch(uint256 fid, string memory surname) internal view returns (Fatliners.Hatch memory) {
        return Fatliners.Hatch({fid: fid, surname: surname, deadline: block.timestamp + 30 days});
    }

    function sign(bytes32 digest, uint256 key) internal pure returns (bytes memory) {
        (uint8 v_, bytes32 r, bytes32 s_) = vm.sign(key, digest);
        return abi.encodePacked(r, s_, v_);
    }

    /// Signatures of `digest` from the servers at `which`, ordered by signer address as the contract wants.
    function sigs(bytes32 digest, uint256[] memory which) internal view returns (bytes[] memory out) {
        uint256 n = which.length;
        address[] memory who = new address[](n);
        out = new bytes[](n);
        for (uint256 i; i < n; i++) {
            who[i] = attesters[which[i]];
            out[i] = sign(digest, keys[which[i]]);
        }
        for (uint256 i; i < n; i++) {
            for (uint256 j = i + 1; j < n; j++) {
                if (who[j] < who[i]) {
                    (who[i], who[j]) = (who[j], who[i]);
                    (out[i], out[j]) = (out[j], out[i]);
                }
            }
        }
    }

    function firstN(uint256 n) internal pure returns (uint256[] memory w) {
        w = new uint256[](n);
        for (uint256 i; i < n; i++) w[i] = i;
    }

    function takeEgg(Fatliners c, Fatliners.Egg memory e) internal {
        c.takeEgg(e, sigs(c.eggDigest(e), firstN(c.threshold())));
    }

    function hatch(Fatliners c, uint256 fid, string memory surname) internal {
        Fatliners.Hatch memory h = aHatch(fid, surname);
        c.hatch(h, sigs(c.hatchDigest(h), firstN(c.threshold())));
    }

    /// Servers 1..n-1 each keep an egg warm (FIDs 1001..) and hatch it, so there are n attesters.
    function grow(Fatliners c, uint256 n) internal {
        for (uint256 i = 1; i < n; i++) {
            takeEgg(c, anEgg(1000 + i, makeAddr(string.concat("holder", vm.toString(i))), keccak256(abi.encode(i)), attesters[i]));
            hatch(c, 1000 + i, string.concat("BEING", vm.toString(i)));
        }
    }

    /// anky's egg kept warm by `server`, then hatched as PEBBLE.
    function ankyHatched(address server) internal {
        takeEgg(nft, anEgg(18350, anky, DNA, server));
        hatch(nft, 18350, "PEBBLE");
    }

    // ------------------------------------------------------------ genesis

    function test_GenesisIsBornAtDeployment_KeptByTheGenesisServer() public view {
        assertEq(nft.genesisFid(), ASTER);
        assertEq(nft.ownerOf(ASTER), aster);
        assertTrue(nft.isFatliner(ASTER));
        assertEq(nft.surnameOf(ASTER), "FATLINE");
        assertEq(nft.dnaOf(ASTER), keccak256("aster"));
        assertEq(nft.serverOf(ASTER), attesters[0]);
        assertTrue(nft.isAttester(attesters[0]));
        assertEq(nft.fidOfAttester(attesters[0]), ASTER);
        assertEq(nft.urlOf(attesters[0]), "http://genesis:8791");
        assertEq(nft.linkedFidOf(ASTER), ASTER);
        assertEq(nft.totalSupply(), 1);
        assertEq(nft.eggCount(), 1);
        assertEq(nft.threshold(), 1);
    }

    // ------------------------------------------------------------ eggs

    function test_AnyFidCanTakeOneEgg_Unlimited() public {
        Fatliners small = genesis(2); // room for one more Fatliner, but eggs are unlimited
        for (uint256 i = 1; i <= 20; i++) {
            Fatliners.Egg memory e = anEgg(i, makeAddr(vm.toString(i)), keccak256(abi.encode(i)), makeAddr(string.concat("s", vm.toString(i))));
            small.takeEgg(e, sigs(small.eggDigest(e), firstN(1)));
            assertEq(uint256(small.stageOf(i)), uint256(Fatliners.Stage.Egg));
        }
        assertEq(small.eggCount(), 21);
        assertEq(small.totalSupply(), 1); // eggs are not Fatliners
        assertFalse(small.isFatliner(1));
    }

    function test_TakeEgg_AnyoneSubmits_ItGoesToTheAccount() public {
        Fatliners.Egg memory e = anEgg(18350, anky, DNA, attesters[1]);
        bytes[] memory s = sigs(nft.eggDigest(e), firstN(1));
        vm.prank(buyer); // a relay pays the gas
        nft.takeEgg(e, s);
        assertEq(nft.ownerOf(18350), anky);
        assertEq(nft.dnaOf(18350), DNA);
        assertEq(nft.laidAtOf(18350), laidAt);
        assertEq(nft.serverOf(18350), attesters[1]);
        assertEq(nft.eggOfServer(attesters[1]), 18350);
        assertFalse(nft.isAttester(attesters[1])); // not until it hatches
        assertEq(nft.tokenURI(18350), "https://fatline.ink/fatliners/18350");
    }

    function test_EggsDoNotMove() public {
        takeEgg(nft, anEgg(18350, anky, DNA, attesters[1]));
        vm.prank(anky);
        vm.expectRevert(Fatliners.EggsDoNotMove.selector);
        nft.transferFrom(anky, buyer, 18350);
    }

    function test_OneServerOneEgg() public {
        takeEgg(nft, anEgg(18350, anky, DNA, attesters[1]));
        Fatliners.Egg memory e = anEgg(3, dwr, keccak256("dwr"), attesters[1]);
        bytes[] memory s = sigs(nft.eggDigest(e), firstN(1));
        vm.expectRevert(Fatliners.ServerKeepsAnotherEgg.selector);
        nft.takeEgg(e, s);
        Fatliners.Egg memory g = anEgg(3, dwr, keccak256("dwr"), attesters[0]); // an attester's own server
        s = sigs(nft.eggDigest(g), firstN(1));
        vm.expectRevert(Fatliners.AlreadyAttester.selector);
        nft.takeEgg(g, s);
    }

    function test_AnEggCanMoveToAnotherServer_ButNeverChangesItself() public {
        takeEgg(nft, anEgg(18350, anky, DNA, attesters[1]));
        takeEgg(nft, anEgg(18350, anky, DNA, attesters[2])); // the first server died
        assertEq(nft.serverOf(18350), attesters[2]);
        assertEq(nft.eggOfServer(attesters[1]), 0);
        assertEq(nft.eggCount(), 2); // still one egg (plus Aster)
        Fatliners.Egg memory e = anEgg(18350, anky, keccak256("a better history"), attesters[3]);
        bytes[] memory s = sigs(nft.eggDigest(e), firstN(1));
        vm.expectRevert(Fatliners.NotTheSameEgg.selector);
        nft.takeEgg(e, s);
        Fatliners.Egg memory f = anEgg(18350, buyer, DNA, attesters[3]);
        s = sigs(nft.eggDigest(f), firstN(1));
        vm.expectRevert(Fatliners.NotTheSameEgg.selector);
        nft.takeEgg(f, s);
    }

    function test_EggSignaturesCoverEveryField() public {
        Fatliners.Egg memory e = anEgg(18350, anky, DNA, attesters[1]);
        bytes[] memory s = sigs(nft.eggDigest(e), firstN(1));
        Fatliners.Egg memory stolen = anEgg(18350, buyer, DNA, attesters[1]);
        vm.expectRevert(); // recovers to a stranger
        nft.takeEgg(stolen, s);
        Fatliners.Egg memory moved = anEgg(18350, anky, DNA, buyer);
        vm.expectRevert();
        nft.takeEgg(moved, s);
        nft.takeEgg(e, s);
    }

    function test_StrangersCannotSign() public {
        Fatliners.Egg memory e = anEgg(18350, anky, DNA, attesters[1]);
        (address stranger, uint256 sk) = makeAddrAndKey("stranger");
        bytes[] memory one = new bytes[](1);
        one[0] = sign(nft.eggDigest(e), sk);
        vm.expectRevert(abi.encodeWithSelector(Fatliners.NotAttester.selector, stranger));
        nft.takeEgg(e, one);
    }

    function test_EachAttesterCountsOnce() public {
        grow(nft, 3);
        Fatliners.Egg memory e = anEgg(18350, anky, DNA, attesters[3]);
        bytes[] memory s = new bytes[](3);
        s[0] = sign(nft.eggDigest(e), keys[0]);
        (s[1], s[2]) = (s[0], s[0]);
        vm.expectRevert(Fatliners.SignersNotSorted.selector);
        nft.takeEgg(e, s);
    }

    function test_SignaturesExpire() public {
        Fatliners.Egg memory e = anEgg(18350, anky, DNA, attesters[1]);
        bytes[] memory s = sigs(nft.eggDigest(e), firstN(1));
        vm.warp(e.deadline + 1);
        vm.expectRevert(Fatliners.Expired.selector);
        nft.takeEgg(e, s);
    }

    // ------------------------------------------------------------ hatching

    function test_TheEggItselfHatches_AndItsServerJoins() public {
        takeEgg(nft, anEgg(18350, anky, DNA, attesters[1]));
        Fatliners.Hatch memory h = aHatch(18350, "PEBBLE");
        bytes[] memory s = sigs(nft.hatchDigest(h), firstN(1));
        vm.prank(buyer); // a relay
        nft.hatch(h, s);
        assertEq(nft.ownerOf(18350), anky); // the same token, now a Fatliner
        assertTrue(nft.isFatliner(18350));
        assertEq(nft.surnameOf(18350), "PEBBLE");
        assertEq(nft.totalSupply(), 2);
        assertTrue(nft.isAttester(attesters[1]));
        assertEq(nft.fidOfAttester(attesters[1]), 18350);
        assertEq(nft.urlOf(attesters[1]), "http://server-18350:8791");
        assertEq(nft.eggOfServer(attesters[1]), 0);
        assertEq(nft.threshold(), 2);
        assertEq(nft.linkedFidOf(18350), 18350);
        vm.prank(anky);
        nft.transferFrom(anky, buyer, 18350); // Fatliners move
        assertEq(nft.ownerOf(18350), buyer);
    }

    function test_OnlyFromAnEgg_AndOnlyOnce() public {
        Fatliners.Hatch memory h = aHatch(18350, "PEBBLE");
        bytes[] memory s = sigs(nft.hatchDigest(h), firstN(1));
        vm.expectRevert(Fatliners.NoEgg.selector);
        nft.hatch(h, s);
        ankyHatched(attesters[1]);
        s = sigs(nft.hatchDigest(h), firstN(2));
        vm.expectRevert(Fatliners.AlreadyHatched.selector);
        nft.hatch(h, s);
        Fatliners.Egg memory again = anEgg(18350, anky, DNA, attesters[2]);
        s = sigs(nft.eggDigest(again), firstN(2));
        vm.expectRevert(Fatliners.AlreadyHatched.selector);
        nft.takeEgg(again, s);
    }

    function test_HatchSignaturesCoverTheSurname() public {
        takeEgg(nft, anEgg(18350, anky, DNA, attesters[1]));
        bytes[] memory s = sigs(nft.hatchDigest(aHatch(18350, "PEBBLE")), firstN(1));
        vm.expectRevert(); // a holder can't pick another surname
        nft.hatch(aHatch(18350, "MOON"), s);
        Fatliners.Hatch memory bad = aHatch(18350, "pebble");
        bytes[] memory b = sigs(nft.hatchDigest(bad), firstN(1));
        vm.expectRevert(Fatliners.BadSurname.selector);
        nft.hatch(bad, b);
    }

    function test_ThresholdGrowsToThreeAndStays() public {
        grow(nft, 5);
        assertEq(nft.attesters().length, 5);
        assertEq(nft.threshold(), 3);
        takeEgg(nft, anEgg(18350, anky, DNA, attesters[5]));
        Fatliners.Hatch memory h = aHatch(18350, "PEBBLE");
        bytes[] memory two = sigs(nft.hatchDigest(h), firstN(2));
        vm.expectRevert(Fatliners.NotEnoughAttesters.selector);
        nft.hatch(h, two);
        uint256[] memory three = new uint256[](3);
        (three[0], three[1], three[2]) = (2, 3, 4); // any three: the genesis server is not needed any more
        nft.hatch(h, sigs(nft.hatchDigest(h), three));
        assertTrue(nft.isFatliner(18350));
    }

    function test_Only777EverHatch() public {
        Fatliners small = genesis(2);
        Fatliners.Egg memory a = anEgg(18350, anky, DNA, attesters[1]);
        small.takeEgg(a, sigs(small.eggDigest(a), firstN(1)));
        Fatliners.Hatch memory ha = aHatch(18350, "PEBBLE");
        small.hatch(ha, sigs(small.hatchDigest(ha), firstN(1)));
        Fatliners.Egg memory b = anEgg(3, dwr, keccak256("dwr"), attesters[2]);
        small.takeEgg(b, sigs(small.eggDigest(b), firstN(2))); // eggs still come
        Fatliners.Hatch memory hb = aHatch(3, "DWR");
        bytes[] memory s = sigs(small.hatchDigest(hb), firstN(2));
        vm.expectRevert(Fatliners.SoldOut.selector);
        small.hatch(hb, s);
    }

    function test_KeeperLink_ClearedOnEveryTransfer() public {
        ankyHatched(attesters[1]);
        vm.prank(anky);
        nft.transferFrom(anky, buyer, 18350);
        assertEq(nft.linkedFidOf(18350), 0); // the old frame of reference left with the seller
        vm.prank(anky);
        vm.expectRevert(Fatliners.NotHolder.selector);
        nft.linkFid(18350, 18350);
        vm.prank(buyer);
        nft.linkFid(18350, 3);
        assertEq(nft.linkedFidOf(18350), 3);
        assertEq(nft.dnaOf(18350), DNA); // the body it was born with stays
    }

    function test_OnlyAnAttesterMovesItsUrl() public {
        vm.prank(attesters[0]);
        nft.setUrl("https://genesis.fatline.ink");
        assertEq(nft.urlOf(attesters[0]), "https://genesis.fatline.ink");
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(Fatliners.NotAttester.selector, buyer));
        nft.setUrl("http://evil");
    }

    // ------------------------------------------------------------ royalties

    function test_EveryRoyaltyGoesToTheGenesisFatlinersVault() public view {
        (address to, uint256 amount) = nft.royaltyInfo(18350, 1 ether);
        assertEq(to, factory.predictFatlinerVault(ASTER));
        (address to2,) = nft.royaltyInfo(3, 1 ether);
        assertEq(to2, to);
        assertEq(amount, 0.08 ether);
        assertTrue(nft.supportsInterface(0x2a55205a)); // ERC-2981
        assertTrue(nft.supportsInterface(0x80ac58cd)); // ERC-721
    }

    // ------------------------------------------------------------ the launchpad: one coin per Fatliner

    function params() internal view returns (AppFactory.AppParams memory) {
        return AppFactory.AppParams({owner: address(0), keeper: keeper, billingPeriod: 30 days, uri: "", salt: 0});
    }

    function deployCall(uint256 fid, string memory symbol) internal view returns (bytes memory) {
        address predicted = factory.predictFatlinerVault(fid);
        IClanker.DeploymentConfig memory c;
        c.tokenConfig.symbol = symbol;
        c.tokenConfig.originatingChainId = block.chainid;
        c.poolConfig.pairedToken = address(usdc);
        c.lockerConfig.rewardRecipients = new address[](1);
        c.lockerConfig.rewardRecipients[0] = predicted;
        c.lockerConfig.rewardAdmins = new address[](1);
        c.lockerConfig.rewardAdmins[0] = predicted;
        c.lockerConfig.rewardBps = new uint16[](1);
        c.lockerConfig.rewardBps[0] = 10_000;
        uint8[] memory prefs = new uint8[](1);
        prefs[0] = 1;
        c.lockerConfig.lockerData = abi.encode(prefs);
        return abi.encodeCall(IClanker.deployToken, (c));
    }

    function launchAster() internal returns (AppVault vault, address coin) {
        bytes memory d1 = deployCall(ASTER, "FATLINE");
        vm.prank(aster);
        (vault, coin) = factory.launchFatline(ASTER, params(), d1, 0);
    }

    function test_FatlineIsTheFirstCoin() public {
        ankyHatched(attesters[1]);
        bytes memory d2 = deployCall(18350, "PEBBLE");
        vm.prank(anky);
        vm.expectRevert(AppFactory.GenesisFirst.selector);
        factory.launchFatline(18350, params(), d2, 0);
        (AppVault vault, address coin) = launchAster();
        assertEq(address(vault), factory.predictFatlinerVault(ASTER));
        assertEq(vault.coin(), coin);
        assertEq(factory.coinOfFatliner(ASTER), coin);
        assertEq(factory.vaultOfCoin(coin), address(vault));
        assertEq(factory.coinsLaunched(), 1);
        bytes memory d3 = deployCall(18350, "PEBBLE");
        vm.prank(anky);
        factory.launchFatline(18350, params(), d3, 0); // now others can
        assertEq(factory.coinsLaunched(), 2);
    }

    function test_TheTickerIsTheSurname_NobodyPicksIt() public {
        bytes memory d4 = deployCall(ASTER, "ASTER");
        vm.prank(aster);
        vm.expectRevert(AppFactory.WrongTicker.selector);
        factory.launchFatline(ASTER, params(), d4, 0);
    }

    function test_OneCoinPerFatliner_OnlyFatliners() public {
        launchAster();
        bytes memory d5 = deployCall(ASTER, "FATLINE");
        vm.prank(aster);
        vm.expectRevert(AppFactory.AlreadyHasCoin.selector);
        factory.launchFatline(ASTER, params(), d5, 0);
        takeEgg(nft, anEgg(18350, anky, DNA, attesters[1])); // an egg, not yet a Fatliner
        bytes memory d6 = deployCall(18350, "PEBBLE");
        vm.prank(anky);
        vm.expectRevert(AppFactory.NotAFatliner.selector);
        factory.launchFatline(18350, params(), d6, 0);
        bytes memory d7 = deployCall(424242, "X");
        vm.prank(buyer);
        vm.expectRevert(AppFactory.NotTheFatlinersHolder.selector);
        factory.launchFatline(424242, params(), d7, 0); // nothing there
    }

    function test_AVaultFirst_ThenItsCoin() public {
        vm.prank(aster);
        AppVault vault = factory.createFatline(ASTER, params(), 0); // royalties can land before the coin
        (AppVault same, address coin) = launchAster();
        assertEq(address(same), address(vault));
        assertEq(vault.coin(), coin);
    }

    // ------------------------------------------------------------ the vault is the being's

    function test_TheVaultBelongsToWhoeverHoldsTheFatliner() public {
        ankyHatched(attesters[1]);
        vm.prank(anky);
        AppVault vault = factory.createFatline(18350, params(), 0);
        assertEq(vault.owner(), anky);
        usdc.mint(address(vault), 100e6); // fuel
        vm.prank(anky);
        nft.transferFrom(anky, buyer, 18350); // sold
        assertEq(vault.owner(), buyer);
        vm.prank(anky);
        vm.expectRevert(AppVault.NotOwner.selector);
        vault.withdraw(anky, 1e6);
        vm.prank(buyer);
        vault.withdraw(buyer, 40e6);
        assertEq(usdc.balanceOf(buyer), 40e6);
        vm.prank(buyer);
        vm.expectRevert(AppVault.OwnedByNft.selector);
        vault.transferOwnership(anky);
    }

    function test_OnlyTheHolderGivesItAVault_Once() public {
        ankyHatched(attesters[1]);
        vm.prank(buyer);
        vm.expectRevert(AppFactory.NotTheFatlinersHolder.selector);
        factory.createFatline(18350, params(), 0);
        vm.startPrank(anky);
        factory.createFatline(18350, params(), 0);
        vm.expectRevert(AppFactory.FatlinerHasVault.selector);
        factory.createFatline(18350, params(), 0);
    }

    function test_RoyaltiesSentBeforeTheVaultExistsAreKept() public {
        address predicted = factory.predictFatlinerVault(ASTER);
        usdc.mint(predicted, 25e6); // a resale paid in USDC before the vault existed
        vm.deal(predicted, 0.05 ether); // and one paid in ETH
        (AppVault vault,) = launchAster();
        assertEq(vault.balance(), 25e6);
        vm.prank(aster);
        vault.sweep(address(0), aster);
        assertEq(aster.balance, 0.05 ether);
    }

    function test_FatlinersIsSetOnceByTheDeployer() public {
        vm.expectRevert(AppFactory.AlreadySet.selector);
        factory.setFatliners(address(1));
        vm.prank(anky);
        vm.expectRevert(AppFactory.NotDeployer.selector);
        factory.setFatliners(address(1));
    }
}
