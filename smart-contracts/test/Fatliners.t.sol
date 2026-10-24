// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
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

    address[] attesters;
    uint256[] keys; // attester private keys, in the same order
    address anky = makeAddr("anky"); // where FID 18350 hatches to
    address dwr = makeAddr("dwr"); // FID 3
    address v = makeAddr("v"); // FID 2
    address keeper = makeAddr("keeper");
    address buyer = makeAddr("buyer");

    bytes32 constant DNA = keccak256("anky's history");
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
        for (uint256 i; i < 5; i++) {
            (address a, uint256 k) = makeAddrAndKey(string.concat("attester", vm.toString(i)));
            attesters.push(a);
            keys.push(k);
        }
        nft = new Fatliners(777, attesters, IFatlineVaults(address(factory)), "https://fatline.ink/fatliners/");
        factory.setFatliners(address(nft));
    }

    // ------------------------------------------------------------ hatching

    function egg(uint256 fid, address to, bytes32 dna) internal view returns (Fatliners.Hatch memory) {
        return Fatliners.Hatch({fid: fid, to: to, dna: dna, laidAt: laidAt, deadline: block.timestamp + 30 days});
    }

    function sign(Fatliners c, Fatliners.Hatch memory h, uint256 key) internal view returns (bytes memory) {
        (uint8 v_, bytes32 r, bytes32 s_) = vm.sign(key, c.hatchDigest(h));
        return abi.encodePacked(r, s_, v_);
    }

    /// Signatures from the attesters at `which`, ordered by signer address as the contract wants them.
    function sigs(Fatliners c, Fatliners.Hatch memory h, uint256[] memory which) internal view returns (bytes[] memory out) {
        uint256 n = which.length;
        address[] memory who = new address[](n);
        out = new bytes[](n);
        for (uint256 i; i < n; i++) {
            who[i] = attesters[which[i]];
            out[i] = sign(c, h, keys[which[i]]);
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

    function hatchAnky() internal {
        Fatliners.Hatch memory h = egg(18350, anky, DNA);
        nft.hatch(h, sigs(nft, h, firstN(3))); // 3 of 5: more than half
    }

    // ------------------------------------------------------------ birth

    function test_Hatch_TokenIdIsTheFid_AnyoneCanSubmit() public {
        Fatliners.Hatch memory h = egg(18350, anky, DNA);
        bytes[] memory s = sigs(nft, h, firstN(3));
        vm.prank(buyer); // a relayer pays the gas; the being still goes to anky
        nft.hatch(h, s);
        assertEq(nft.ownerOf(18350), anky);
        assertEq(nft.dnaOf(18350), DNA);
        assertEq(nft.laidAtOf(18350), laidAt);
        assertEq(nft.totalSupply(), 1);
        assertEq(nft.tokenURI(18350), "https://fatline.ink/fatliners/18350");
        assertEq(nft.WARM_DAYS(), 3);
    }

    function test_SignaturesCoverEveryField() public {
        Fatliners.Hatch memory h = egg(18350, anky, DNA);
        bytes[] memory s = sigs(nft, h, firstN(3));
        Fatliners.Hatch memory stolen = egg(18350, buyer, DNA); // someone copies the signatures to take it
        vm.expectRevert(); // recovers to strangers
        nft.hatch(stolen, s);
        Fatliners.Hatch memory otherHistory = egg(18350, anky, keccak256("another history"));
        vm.expectRevert();
        nft.hatch(otherHistory, s);
        nft.hatch(h, s);
        assertEq(nft.ownerOf(18350), anky);
    }

    function test_EachFidIsBornOnce() public {
        hatchAnky();
        Fatliners.Hatch memory again = egg(18350, buyer, DNA);
        bytes[] memory s = sigs(nft, again, firstN(5));
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721InvalidSender.selector, address(0)));
        nft.hatch(again, s);
    }

    function test_MoreThanHalfOfTheAttesters() public {
        assertEq(nft.threshold(), 3); // 5 attesters
        address[] memory four = new address[](4);
        for (uint256 i; i < 4; i++) four[i] = attesters[i];
        assertEq(new Fatliners(777, four, IFatlineVaults(address(factory)), "").threshold(), 3); // not 2: no ties
        Fatliners.Hatch memory h = egg(18350, anky, DNA);
        bytes[] memory two = sigs(nft, h, firstN(2));
        vm.expectRevert(Fatliners.NotEnoughAttesters.selector);
        nft.hatch(h, two);
    }

    function test_EachAttesterCountsOnce() public {
        Fatliners.Hatch memory h = egg(18350, anky, DNA);
        bytes[] memory s = new bytes[](3);
        s[0] = sign(nft, h, keys[0]);
        s[1] = s[0];
        s[2] = s[0];
        vm.expectRevert(Fatliners.SignersNotSorted.selector);
        nft.hatch(h, s);
    }

    function test_StrangersCannotSign() public {
        Fatliners.Hatch memory h = egg(18350, anky, DNA);
        bytes[] memory s = sigs(nft, h, firstN(2));
        (address stranger, uint256 sk) = makeAddrAndKey("stranger");
        bytes[] memory three = new bytes[](3);
        // put the stranger's signature where its address sorts
        bytes memory st = sign(nft, h, sk);
        address a0 = ECDSA.recover(nft.hatchDigest(h), s[0]);
        address a1 = ECDSA.recover(nft.hatchDigest(h), s[1]);
        if (stranger < a0) (three[0], three[1], three[2]) = (st, s[0], s[1]);
        else if (stranger < a1) (three[0], three[1], three[2]) = (s[0], st, s[1]);
        else (three[0], three[1], three[2]) = (s[0], s[1], st);
        vm.expectRevert(abi.encodeWithSelector(Fatliners.NotAttester.selector, stranger));
        nft.hatch(h, three);
    }

    function test_AHatchExpires() public {
        Fatliners.Hatch memory h = egg(18350, anky, DNA);
        bytes[] memory s = sigs(nft, h, firstN(3));
        vm.warp(h.deadline + 1);
        vm.expectRevert(Fatliners.Expired.selector);
        nft.hatch(h, s);
    }

    function test_KeeperLink_ClearedOnEveryTransfer() public {
        hatchAnky();
        assertEq(nft.linkedFidOf(18350), 18350); // at birth: its origin
        vm.prank(anky);
        nft.transferFrom(anky, buyer, 18350);
        assertEq(nft.linkedFidOf(18350), 0); // the old frame of reference left with the seller
        vm.prank(anky);
        vm.expectRevert(Fatliners.NotHolder.selector);
        nft.linkFid(18350, 18350);
        vm.prank(buyer);
        nft.linkFid(18350, 3); // the buyer lives through FID 3
        assertEq(nft.linkedFidOf(18350), 3);
        assertEq(nft.dnaOf(18350), DNA); // the body it was born with stays
    }

    function test_NoMoreThanMaxSupply() public {
        Fatliners small = new Fatliners(1, attesters, IFatlineVaults(address(factory)), "");
        Fatliners.Hatch memory a = egg(18350, anky, DNA);
        small.hatch(a, sigs(small, a, firstN(3)));
        Fatliners.Hatch memory b = egg(3, dwr, keccak256("dwr"));
        bytes[] memory s = sigs(small, b, firstN(3));
        vm.expectRevert(Fatliners.SoldOut.selector);
        small.hatch(b, s);
    }

    // ------------------------------------------------------------ royalties

    function test_Royalty8PercentToTheFatlinersOwnVault() public view {
        (address to, uint256 amount) = nft.royaltyInfo(18350, 1 ether);
        assertEq(to, factory.predictFatlinerVault(18350));
        assertEq(amount, 0.08 ether);
        assertTrue(nft.supportsInterface(0x2a55205a)); // ERC-2981
        assertTrue(nft.supportsInterface(0x80ac58cd)); // ERC-721
    }

    // ------------------------------------------------------------ the vault is the being's

    function params() internal view returns (AppFactory.AppParams memory) {
        return AppFactory.AppParams({owner: address(0), keeper: keeper, billingPeriod: 30 days, uri: "", salt: 0});
    }

    function born() internal returns (AppVault vault) {
        hatchAnky();
        vm.prank(anky);
        vault = factory.createFatline(18350, params(), 0);
    }

    function test_TheVaultBelongsToWhoeverHoldsTheFatliner() public {
        AppVault vault = born();
        assertEq(address(vault), factory.predictFatlinerVault(18350));
        assertEq(factory.vaultOfFatliner(18350), address(vault));
        assertEq(vault.owner(), anky);

        usdc.mint(address(vault), 100e6); // fuel
        vm.prank(anky);
        nft.transferFrom(anky, buyer, 18350); // sold
        assertEq(vault.owner(), buyer);

        vm.prank(anky);
        vm.expectRevert(AppVault.NotOwner.selector);
        vault.withdraw(anky, 1e6);
        vm.prank(buyer);
        vault.withdraw(buyer, 40e6); // the holder decides where the fees go
        assertEq(usdc.balanceOf(buyer), 40e6);

        vm.prank(buyer);
        vm.expectRevert(AppVault.OwnedByNft.selector);
        vault.transferOwnership(anky);
    }

    function test_OnlyTheHolderGivesItAVault_Once() public {
        hatchAnky();
        vm.prank(buyer);
        vm.expectRevert(AppFactory.NotTheFatlinersHolder.selector);
        factory.createFatline(18350, params(), 0);
        vm.prank(buyer);
        vm.expectRevert(AppFactory.NotTheFatlinersHolder.selector);
        factory.createFatline(424242, params(), 0); // never born
        vm.startPrank(anky);
        factory.createFatline(18350, params(), 0);
        vm.expectRevert(AppFactory.FatlinerHasVault.selector);
        factory.createFatline(18350, params(), 0);
    }

    function test_RoyaltiesSentBeforeTheVaultExistsAreKept() public {
        address predicted = factory.predictFatlinerVault(18350);
        usdc.mint(predicted, 25e6); // a resale paid in USDC before the node was lit
        vm.deal(predicted, 0.05 ether); // and one paid in ETH
        AppVault vault = born();
        assertEq(vault.balance(), 25e6);
        vm.prank(anky);
        vault.sweep(address(0), anky);
        assertEq(anky.balance, 0.05 ether);
        vm.prank(anky);
        vm.expectRevert(AppVault.UseWithdraw.selector);
        vault.sweep(address(usdc), anky);
    }

    function test_LaunchFatline_FeesGoToItsVault() public {
        hatchAnky();
        address predicted = factory.predictFatlinerVault(18350);

        IClanker.DeploymentConfig memory c;
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

        vm.prank(anky);
        (AppVault vault, address coin) = factory.launchFatline(18350, params(), abi.encodeCall(IClanker.deployToken, (c)), 0);
        assertEq(address(vault), predicted);
        assertEq(vault.coin(), coin);
        assertEq(factory.vaultOfCoin(coin), predicted);
    }

    function test_FatlinersIsSetOnceByTheDeployer() public {
        vm.expectRevert(AppFactory.AlreadySet.selector);
        factory.setFatliners(address(1));
        vm.prank(anky);
        vm.expectRevert(AppFactory.NotDeployer.selector);
        factory.setFatliners(address(1));
    }
}
