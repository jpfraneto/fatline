// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, stdStorage, StdStorage} from "forge-std/Test.sol";
import {IERC721Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {FatlineLaunchpad} from "../src/FatlineLaunchpad.sol";
import {AppVault} from "../src/AppVault.sol";
import {Fatliners} from "../src/Fatliners.sol";
import {IClanker} from "../src/interfaces/IClanker.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {MockClanker, MockFeeLocker, MockLocker} from "./mocks/MockClanker.sol";

contract FatlinersTest is Test {
    using stdStorage for StdStorage;

    MockUSDC usdc;
    MockLocker locker;
    MockFeeLocker feeLocker;
    MockClanker clanker;
    Fatliners factory; // the launchpad is the Fatliners contract itself
    Fatliners nft;

    // attesters[0] is the genesis server (it keeps Aster alive); attesters[1..5] join by hatching eggs.
    address[] attesters;
    uint256[] keys;
    address anky = makeAddr("anky"); // FID 18350's egg goes here
    address dwr = makeAddr("dwr"); // FID 3
    address keeper = makeAddr("keeper");
    address buyer = makeAddr("buyer");
    address aster = makeAddr("aster's keeper");
    address royalty = makeAddr("jpfraneto.eth");

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
        for (uint256 i; i < 6; i++) {
            (address a, uint256 k) = makeAddrAndKey(string.concat("server", vm.toString(i)));
            attesters.push(a);
            keys.push(k);
        }
        nft = genesis(777);
        factory = nft;
    }

    function genesis(uint256 max) internal returns (Fatliners) {
        AppVault.Tier[] memory t = new AppVault.Tier[](1);
        t[0] = AppVault.Tier(30, 0); // ~2.59 USDC a day: one node's fuel
        return new Fatliners(
            max, Fatliners.Genesis(attesters[0], "http://genesis:8791", ASTER, aster, "FATLINE", keccak256("aster"), laidAt, 5, address(0), royalty),
            "https://fatline.ink/fatliners/",
            FatlineLaunchpad.Clanker(address(usdc), address(clanker), address(locker), address(feeLocker)), t
        );
    }

    // ------------------------------------------------------------ signing

    function anEgg(uint256 fid, address to, bytes32 dna, address server) internal view returns (Fatliners.Egg memory) {
        return Fatliners.Egg({
            fid: fid, to: to, server: server, url: string.concat("http://server-", vm.toString(fid), ":8791"),
            dna: dna, laidAt: laidAt, surname: surnameFor(fid), stone: 1, deadline: block.timestamp + 30 days
        });
    }

    /// The surname the attesters read from each test egg's DNA.
    function surnameFor(uint256 fid) internal pure returns (string memory) {
        if (fid == 18350) return "PEBBLE";
        if (fid == 3) return "DWR";
        if (fid > 1000 && fid < 2000) return string.concat("BEING", vm.toString(fid - 1000));
        return string.concat("F", vm.toString(fid));
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
        c.takeEgg(e, sigs(c.eggDigest(e), firstN(c.threshold())), 0, new bytes32[](0));
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

    function test_GenesisStartsAsAnEgg_KeptByTheGenesisServer_ThatHatchesIt() public {
        assertEq(nft.genesisFid(), ASTER);
        assertEq(nft.ownerOf(ASTER), aster);
        assertEq(uint256(nft.stageOf(ASTER)), uint256(Fatliners.Stage.Egg));
        assertFalse(nft.isFatliner(ASTER));
        assertEq(nft.surnameOf(ASTER), "FATLINE");
        assertEq(nft.stoneOf(ASTER), 5);
        assertEq(nft.serverOf(ASTER), attesters[0]);
        assertTrue(nft.isAttester(attesters[0])); // from the start, so someone can sign Aster's own hatching
        assertEq(nft.linkedFidOf(ASTER), ASTER);
        assertEq(nft.totalSupply(), 0);
        assertEq(nft.liveEggs(), 1);
        assertEq(nft.threshold(), 1);
        hatch(nft, ASTER, "FATLINE"); // three warm days later
        assertTrue(nft.isFatliner(ASTER));
        assertEq(nft.totalSupply(), 1);
        assertEq(nft.liveEggs(), 0);
        assertEq(nft.attesters().length, 1); // not twice
    }

    // ------------------------------------------------------------ eggs

    function test_777Slots_EggsAndFatlinersTogether() public {
        Fatliners small = genesis(3); // Aster's egg + two more
        for (uint256 i = 1; i <= 2; i++) {
            Fatliners.Egg memory e = anEgg(i, makeAddr(vm.toString(i)), keccak256(abi.encode(i)), makeAddr(string.concat("s", vm.toString(i))));
            small.takeEgg(e, sigs(small.eggDigest(e), firstN(1)), 0, new bytes32[](0));
        }
        assertEq(small.liveEggs(), 3);
        Fatliners.Egg memory f = anEgg(9, makeAddr("9"), keccak256("9"), makeAddr("s9"));
        bytes[] memory s9 = sigs(small.eggDigest(f), firstN(1));
        vm.expectRevert(Fatliners.NoSlot.selector);
        small.takeEgg(f, s9, 0, new bytes32[](0));
    }

    function test_TakeEgg_AnyoneSubmits_ItGoesToTheAccount() public {
        Fatliners.Egg memory e = anEgg(18350, anky, DNA, attesters[1]);
        bytes[] memory s = sigs(nft.eggDigest(e), firstN(1));
        vm.prank(buyer); // a relay pays the gas
        nft.takeEgg(e, s, 0, new bytes32[](0));
        assertEq(nft.ownerOf(18350), anky);
        assertEq(nft.dnaOf(18350), DNA);
        assertEq(nft.laidAtOf(18350), laidAt);
        assertEq(nft.serverOf(18350), attesters[1]);
        assertEq(nft.eggOfServer(attesters[1]), 18350);
        assertFalse(nft.isAttester(attesters[1])); // not until it hatches
        assertEq(nft.tokenURI(18350), "https://fatline.ink/fatliners/18350");
    }

    function test_AMovedTokenSleepsUntilItsNewHolderWakesIt() public {
        takeEgg(nft, anEgg(18350, anky, DNA, attesters[1]));
        sell(18350, anky, buyer, 50e6); // the only way it changes hands
        assertTrue(nft.isAsleep(18350));
        Fatliners.Hatch memory h = aHatch(18350, "PEBBLE");
        bytes[] memory hs = sigs(nft.hatchDigest(h), firstN(1));
        vm.expectRevert(Fatliners.Asleep.selector); // it can't hatch asleep
        nft.hatch(h, hs);
        // The buyer chooses the account it lives through (FID 3); the attesters sign that history's DNA and stone.
        Fatliners.Awaken memory a = Fatliners.Awaken(18350, buyer, 3, keccak256("dwr's history"), 2, block.timestamp + 1 days);
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domain(), keccak256(abi.encode(nft.AWAKEN_TYPEHASH(), a.fid, a.holder, a.sourceFid, a.dna, a.stone, a.deadline))));
        Fatliners.Awaken memory wrong = Fatliners.Awaken(18350, anky, 3, a.dna, 2, a.deadline);
        bytes[] memory ws = sigs(digest, firstN(1));
        vm.expectRevert(Fatliners.NotHolder.selector);
        nft.awaken(wrong, ws);
        nft.awaken(a, sigs(digest, firstN(1)));
        assertFalse(nft.isAsleep(18350));
        assertEq(nft.linkedFidOf(18350), 3);
        assertEq(nft.dnaOf(18350), keccak256("dwr's history"));
        assertEq(nft.stoneOf(18350), 2);
        assertEq(nft.surnameOf(18350), "PEBBLE"); // its name and ticker stay
        nft.hatch(h, hs); // it hatches with the new holder's information
        assertTrue(nft.isFatliner(18350));
    }

    function domain() internal view returns (bytes32) {
        return keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("Fatliners"), keccak256("1"), block.chainid, address(nft)
        ));
    }

    function test_AnEggWhoseNodeStoppedDies_ItsAccountHibernates7Days() public {
        takeEgg(nft, anEgg(3, dwr, keccak256("dwr"), attesters[1]));
        Fatliners.Death memory d = Fatliners.Death(3, block.timestamp + 1 days);
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domain(), keccak256(abi.encode(nft.DEATH_TYPEHASH(), d.fid, d.deadline))));
        nft.die(d, sigs(digest, firstN(1)));
        assertEq(uint256(nft.stageOf(3)), 0);
        assertEq(nft.liveEggs(), 1); // only Aster's
        assertEq(nft.eggOfServer(attesters[1]), 0); // the server is free
        Fatliners.Egg memory again = anEgg(3, dwr, keccak256("dwr"), attesters[1]);
        bytes[] memory s = sigs(nft.eggDigest(again), firstN(1));
        vm.expectRevert(Fatliners.Hibernating.selector);
        nft.takeEgg(again, s, 0, new bytes32[](0));
        vm.warp(block.timestamp + 7 days);
        again.deadline = block.timestamp + 1 days;
        takeEgg(nft, again); // its turn again
        Fatliners.Death memory aster = Fatliners.Death(ASTER, block.timestamp + 1 days);
        bytes32 ad = keccak256(abi.encodePacked("\x19\x01", domain(), keccak256(abi.encode(nft.DEATH_TYPEHASH(), aster.fid, aster.deadline))));
        bytes[] memory as_ = sigs(ad, firstN(1));
        vm.expectRevert(Fatliners.StillAnEgg.selector);
        nft.die(aster, as_);
    }

    function test_TheRankingDecidesWhoseTurnItIs() public {
        // Two leaves: FID 3 at position 1, FID 18350 at position 800 (day 2's window). Standard OZ Merkle leaves.
        bytes32 l1 = keccak256(bytes.concat(keccak256(abi.encode(uint256(3), uint256(1)))));
        bytes32 l2 = keccak256(bytes.concat(keccak256(abi.encode(uint256(18350), uint256(800)))));
        bytes32 root = l1 < l2 ? keccak256(abi.encode(l1, l2)) : keccak256(abi.encode(l2, l1));
        vm.prank(buyer);
        vm.expectRevert(Fatliners.NotOrderAdmin.selector);
        nft.setOrder(root, uint64(block.timestamp));
        nft.setOrder(root, uint64(block.timestamp)); // this test contract deployed it
        bytes32[] memory p1 = new bytes32[](1);
        p1[0] = l2;
        bytes32[] memory p2 = new bytes32[](1);
        p2[0] = l1;
        assertTrue(nft.mayTakeEgg(3, 1, p1));
        assertFalse(nft.mayTakeEgg(3, 2, p1)); // a made-up position
        assertFalse(nft.mayTakeEgg(18350, 800, p2)); // day 1: ranks 1-777
        Fatliners.Egg memory e = anEgg(18350, anky, DNA, attesters[1]);
        bytes[] memory s = sigs(nft.eggDigest(e), firstN(1));
        vm.expectRevert(Fatliners.NotYourTurn.selector);
        nft.takeEgg(e, s, 800, p2);
        vm.warp(block.timestamp + 1 days);
        e.deadline = block.timestamp + 1 days;
        s = sigs(nft.eggDigest(e), firstN(1));
        nft.takeEgg(e, s, 800, p2); // day 2: ranks 1-7,777
        assertEq(nft.ownerOf(18350), anky);
    }

    function test_OneServerOneEgg() public {
        takeEgg(nft, anEgg(18350, anky, DNA, attesters[1]));
        Fatliners.Egg memory e = anEgg(3, dwr, keccak256("dwr"), attesters[1]);
        bytes[] memory s = sigs(nft.eggDigest(e), firstN(1));
        vm.expectRevert(Fatliners.ServerKeepsAnotherEgg.selector);
        nft.takeEgg(e, s, 0, new bytes32[](0));
        Fatliners.Egg memory g = anEgg(3, dwr, keccak256("dwr"), attesters[0]); // an attester's own server
        s = sigs(nft.eggDigest(g), firstN(1));
        vm.expectRevert(Fatliners.AlreadyAttester.selector);
        nft.takeEgg(g, s, 0, new bytes32[](0));
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
        nft.takeEgg(e, s, 0, new bytes32[](0));
        Fatliners.Egg memory f = anEgg(18350, buyer, DNA, attesters[3]);
        s = sigs(nft.eggDigest(f), firstN(1));
        vm.expectRevert(Fatliners.NotTheSameEgg.selector);
        nft.takeEgg(f, s, 0, new bytes32[](0));
    }

    function test_EggSignaturesCoverEveryField() public {
        Fatliners.Egg memory e = anEgg(18350, anky, DNA, attesters[1]);
        bytes[] memory s = sigs(nft.eggDigest(e), firstN(1));
        Fatliners.Egg memory stolen = anEgg(18350, buyer, DNA, attesters[1]);
        vm.expectRevert(); // recovers to a stranger
        nft.takeEgg(stolen, s, 0, new bytes32[](0));
        Fatliners.Egg memory moved = anEgg(18350, anky, DNA, buyer);
        vm.expectRevert();
        nft.takeEgg(moved, s, 0, new bytes32[](0));
        nft.takeEgg(e, s, 0, new bytes32[](0));
    }

    function test_StrangersCannotSign() public {
        Fatliners.Egg memory e = anEgg(18350, anky, DNA, attesters[1]);
        (address stranger, uint256 sk) = makeAddrAndKey("stranger");
        bytes[] memory one = new bytes[](1);
        one[0] = sign(nft.eggDigest(e), sk);
        vm.expectRevert(abi.encodeWithSelector(Fatliners.NotAttester.selector, stranger));
        nft.takeEgg(e, one, 0, new bytes32[](0));
    }

    function test_EachAttesterCountsOnce() public {
        grow(nft, 3);
        Fatliners.Egg memory e = anEgg(18350, anky, DNA, attesters[3]);
        bytes[] memory s = new bytes[](3);
        s[0] = sign(nft.eggDigest(e), keys[0]);
        (s[1], s[2]) = (s[0], s[0]);
        vm.expectRevert(Fatliners.SignersNotSorted.selector);
        nft.takeEgg(e, s, 0, new bytes32[](0));
    }

    function test_SignaturesExpire() public {
        Fatliners.Egg memory e = anEgg(18350, anky, DNA, attesters[1]);
        bytes[] memory s = sigs(nft.eggDigest(e), firstN(1));
        vm.warp(e.deadline + 1);
        vm.expectRevert(Fatliners.Expired.selector);
        nft.takeEgg(e, s, 0, new bytes32[](0));
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
        assertEq(nft.totalSupply(), 1); // Aster is still an egg here
        assertTrue(nft.isAttester(attesters[1]));
        assertEq(nft.fidOfAttester(attesters[1]), 18350);
        assertEq(nft.urlOf(attesters[1]), "http://server-18350:8791");
        assertEq(nft.eggOfServer(attesters[1]), 0);
        assertEq(nft.threshold(), 2);
        assertEq(nft.linkedFidOf(18350), 18350);
        sell(18350, anky, buyer, 50e6); // the only way it changes hands
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
        nft.takeEgg(again, s, 0, new bytes32[](0));
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
        small.takeEgg(a, sigs(small.eggDigest(a), firstN(1)), 0, new bytes32[](0));
        Fatliners.Hatch memory ha = aHatch(18350, "PEBBLE");
        small.hatch(ha, sigs(small.hatchDigest(ha), firstN(1)));
        Fatliners.Egg memory b = anEgg(3, dwr, keccak256("dwr"), attesters[2]);
        bytes[] memory bs = sigs(small.eggDigest(b), firstN(2));
        vm.expectRevert(Fatliners.NoSlot.selector); // Aster's egg + one Fatliner fill both slots
        small.takeEgg(b, bs, 0, new bytes32[](0));
    }

    function test_KeeperLink_ClearedOnEveryTransfer() public {
        ankyHatched(attesters[1]);
        assertEq(nft.linkedFidOf(18350), 18350);
        sell(18350, anky, buyer, 50e6); // the only way it changes hands
        assertEq(nft.linkedFidOf(18350), 0); // asleep: the old frame of reference left with the seller
        assertEq(nft.dnaOf(18350), DNA); // until it is woken, the body it was born with stays
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

    function test_EveryRoyaltyGoesToTheBuilder() public view {
        (address to, uint256 amount) = nft.royaltyInfo(18350, 1 ether);
        assertEq(to, royalty);
        (address to2,) = nft.royaltyInfo(3, 1 ether);
        assertEq(to2, to);
        assertEq(amount, 0.08 ether);
        assertTrue(nft.supportsInterface(0x2a55205a)); // ERC-2981
        assertTrue(nft.supportsInterface(0x80ac58cd)); // ERC-721
    }

    // ------------------------------------------------------------ the launchpad: one coin per Fatliner

    function params() internal view returns (FatlineLaunchpad.AppParams memory) {
        return FatlineLaunchpad.AppParams({owner: address(0), keeper: keeper, billingPeriod: 30 days, uri: "", salt: 0});
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
        vm.expectRevert(FatlineLaunchpad.GenesisFirst.selector);
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
        vm.expectRevert(FatlineLaunchpad.WrongTicker.selector);
        factory.launchFatline(ASTER, params(), d4, 0);
    }

    function test_OneCoinPerFatliner_EggsToo() public {
        launchAster();
        bytes memory d5 = deployCall(ASTER, "FATLINE");
        vm.prank(aster);
        vm.expectRevert(FatlineLaunchpad.AlreadyHasCoin.selector);
        factory.launchFatline(ASTER, params(), d5, 0);
        takeEgg(nft, anEgg(18350, anky, DNA, attesters[1])); // an egg, not yet a Fatliner: it has its coin already
        assertEq(nft.surnameOf(18350), "PEBBLE");
        bytes memory wrong = deployCall(18350, "MOON");
        vm.prank(anky);
        vm.expectRevert(FatlineLaunchpad.WrongTicker.selector);
        factory.launchFatline(18350, params(), wrong, 0);
        bytes memory d6 = deployCall(18350, "PEBBLE");
        vm.prank(buyer);
        vm.expectRevert(FatlineLaunchpad.NotTheFatlinersHolder.selector);
        factory.launchFatline(18350, params(), d6, 0);
        vm.prank(anky);
        (AppVault eggVault, address eggCoin) = factory.launchFatline(18350, params(), d6, 0);
        assertEq(eggVault.owner(), anky);
        assertEq(eggVault.coin(), eggCoin);
        hatch(nft, 18350, "PEBBLE"); // hatching keeps the coin and the surname
        assertEq(factory.coinOfFatliner(18350), eggCoin);
        bytes memory d7 = deployCall(424242, "X");
        vm.prank(buyer);
        vm.expectRevert(FatlineLaunchpad.NotAFatliner.selector);
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
        sell(18350, anky, buyer, 50e6); // the only way it changes hands
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
        vm.expectRevert(FatlineLaunchpad.NotTheFatlinersHolder.selector);
        factory.createFatline(18350, params(), 0);
        vm.startPrank(anky);
        factory.createFatline(18350, params(), 0);
        vm.expectRevert(FatlineLaunchpad.FatlinerHasVault.selector);
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

    function test_The777thCoinIsTheLast() public {
        launchAster();
        takeEgg(nft, anEgg(18350, anky, DNA, attesters[1]));
        assertEq(factory.MAX_COINS(), 777);
        stdstore.target(address(nft)).sig("coinsLaunched()").checked_write(uint256(777));
        bytes memory d = deployCall(18350, "PEBBLE");
        vm.prank(anky);
        vm.expectRevert(FatlineLaunchpad.AllCoinsLaunched.selector);
        factory.launchFatline(18350, params(), d, 0);
    }

    function test_OneContract_TheLaunchpadIsTheFatliners() public view {
        assertEq(address(factory), address(nft));
        assertEq(AppVault(payable(nft.vaultImplementation())).factory(), address(nft));
    }

    function test_NoTwoEggsShareASurname() public {
        takeEgg(nft, anEgg(18350, anky, DNA, attesters[1])); // PEBBLE
        Fatliners.Egg memory same = anEgg(3, dwr, keccak256("dwr"), attesters[2]);
        same.surname = "PEBBLE";
        bytes[] memory s = sigs(nft.eggDigest(same), firstN(nft.threshold()));
        vm.expectRevert(Fatliners.SurnameTaken.selector);
        nft.takeEgg(same, s, 0, new bytes32[](0));
        Fatliners.Egg memory fatline = anEgg(3, dwr, keccak256("dwr"), attesters[2]);
        fatline.surname = "FATLINE"; // Aster's, reserved at genesis
        bytes[] memory f = sigs(nft.eggDigest(fatline), firstN(nft.threshold()));
        vm.expectRevert(Fatliners.SurnameTaken.selector);
        nft.takeEgg(fatline, f, 0, new bytes32[](0));
        takeEgg(nft, anEgg(3, dwr, keccak256("dwr"), attesters[2])); // its own next name: fine
        assertEq(nft.fidOfSurname(keccak256("DWR")), 3);
    }

    function test_TheEggCarriesItsStone() public {
        Fatliners.Egg memory e = anEgg(18350, anky, DNA, attesters[1]);
        e.stone = 6; // opal: a newcomer
        takeEgg(nft, e);
        assertEq(nft.stoneOf(18350), 6);
        Fatliners.Egg memory moved = anEgg(18350, anky, DNA, attesters[2]);
        moved.stone = 3; // a move can't change it
        bytes[] memory s = sigs(nft.eggDigest(moved), firstN(nft.threshold()));
        vm.expectRevert(Fatliners.NotTheSameEgg.selector);
        nft.takeEgg(moved, s, 0, new bytes32[](0));
        Fatliners.Egg memory bad = anEgg(3, dwr, keccak256("dwr"), attesters[3]);
        bad.stone = 7;
        bytes[] memory b = sigs(nft.eggDigest(bad), firstN(nft.threshold()));
        vm.expectRevert(Fatliners.BadStone.selector);
        nft.takeEgg(bad, b, 0, new bytes32[](0));
    }

    function test_OneFatlineOneContract() public {
        takeEgg(nft, anEgg(18350, anky, DNA, attesters[1]));
        vm.prank(buyer);
        vm.expectRevert(Fatliners.NotHolder.selector);
        nft.setApp(18350, address(usdc));
        vm.prank(anky);
        vm.expectRevert(Fatliners.NotAContract.selector);
        nft.setApp(18350, buyer);
        vm.prank(anky);
        nft.setApp(18350, address(usdc)); // the egg's holder ties one contract to it
        assertEq(nft.appOf(18350), address(usdc));
        vm.prank(anky);
        nft.setApp(18350, address(clanker)); // another replaces it: still one
        assertEq(nft.appOf(18350), address(clanker));
        vm.expectRevert(Fatliners.NoEgg.selector);
        nft.setApp(424242, address(usdc));
    }

    /// The holder lists, the buyer pays in USDC: the only way a token changes hands.
    function sell(uint256 fid, address seller, address to, uint256 price) internal {
        vm.prank(seller);
        nft.list(fid, price);
        usdc.mint(to, price);
        vm.startPrank(to);
        usdc.approve(address(nft), price);
        nft.buy(fid, price);
        vm.stopPrank();
    }

    function test_TokensMoveOnlyBySale_8PercentToAster() public {
        takeEgg(nft, anEgg(18350, anky, DNA, attesters[1]));
        vm.startPrank(anky);
        vm.expectRevert(Fatliners.OnlyBySale.selector);
        nft.transferFrom(anky, buyer, 18350);
        vm.expectRevert(Fatliners.OnlyBySale.selector);
        nft.safeTransferFrom(anky, buyer, 18350);
        vm.stopPrank();
        vm.prank(buyer);
        vm.expectRevert(Fatliners.NotForSale.selector);
        nft.buy(18350, 1e6);
        vm.prank(buyer);
        vm.expectRevert(Fatliners.NotHolder.selector);
        nft.list(18350, 1e6);
        vm.prank(anky);
        nft.list(18350, 100e6);
        usdc.mint(buyer, 100e6);
        vm.startPrank(buyer);
        usdc.approve(address(nft), 100e6);
        vm.expectRevert(Fatliners.PriceChanged.selector);
        nft.buy(18350, 99e6);
        nft.buy(18350, 100e6);
        vm.stopPrank();
        assertEq(nft.ownerOf(18350), buyer);
        assertEq(usdc.balanceOf(anky), 92e6);
        assertEq(usdc.balanceOf(royalty), 8e6); // the one who built it
        assertEq(nft.priceOf(18350), 0); // the listing ended with the sale
        assertTrue(nft.isAsleep(18350));
    }
}
