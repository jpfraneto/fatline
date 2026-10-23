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

    address publisher = makeAddr("publisher");
    address anky = makeAddr("anky"); // FID 18350's address in the list
    address dwr = makeAddr("dwr"); // FID 3
    address v = makeAddr("v"); // FID 2
    address late = makeAddr("late"); // FID 99999, only on day two's list
    address keeper = makeAddr("keeper");
    address buyer = makeAddr("buyer");

    bytes32 constant DNA = keccak256("anky's history");
    uint256 day1;

    function setUp() public {
        vm.warp(1_792_600_000); // October 2026
        day1 = block.timestamp / 1 days;
        usdc = new MockUSDC();
        locker = new MockLocker();
        feeLocker = new MockFeeLocker();
        clanker = new MockClanker(locker, address(usdc));
        AppVault.Tier[] memory t = new AppVault.Tier[](1);
        t[0] = AppVault.Tier(30, 0); // ~2.59 USDC a day: one node's fuel
        factory = new AppFactory(address(usdc), address(clanker), address(locker), address(feeLocker), t);
        nft = new Fatliners(777, publisher, IFatlineVaults(address(factory)), "https://fatline.ink/fatliners/");
        factory.setFatliners(address(nft));
    }

    // ------------------------------------------------------------ the list

    function hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encode(a, b)) : keccak256(abi.encode(b, a));
    }

    /// Day one's list: four accounts. Returns the root and each leaf's proof.
    function dayOneList() internal returns (bytes32 root, bytes32[][] memory proofs) {
        bytes32[4] memory l = [
            nft.leaf(18350, anky, 1, DNA),
            nft.leaf(3, dwr, 2, keccak256("dwr")),
            nft.leaf(2, v, 3, keccak256("v")),
            nft.leaf(1, makeAddr("farcaster"), 4, keccak256("fc"))
        ];
        bytes32 n01 = hashPair(l[0], l[1]);
        bytes32 n23 = hashPair(l[2], l[3]);
        root = hashPair(n01, n23);
        proofs = new bytes32[][](4);
        for (uint256 i; i < 4; i++) {
            proofs[i] = new bytes32[](2);
            proofs[i][0] = l[i ^ 1];
            proofs[i][1] = i < 2 ? n23 : n01;
        }
    }

    function publishDayOne() internal returns (bytes32[][] memory proofs) {
        bytes32 root;
        (root, proofs) = dayOneList();
        vm.prank(publisher);
        nft.publishRoot(day1, root, 777, "https://fatline.ink/lists/day-1.json");
    }

    // ------------------------------------------------------------ birth

    function test_MintFromTodaysList_TokenIdIsTheFid() public {
        bytes32[][] memory proofs = publishDayOne();
        vm.prank(anky);
        nft.mint(18350, 1, DNA, proofs[0]);
        assertEq(nft.ownerOf(18350), anky);
        assertEq(nft.dnaOf(18350), DNA);
        assertEq(nft.rankOf(18350), 1);
        assertEq(nft.totalSupply(), 1);
        assertEq(nft.tokenURI(18350), "https://fatline.ink/fatliners/18350");
    }

    function test_OnlyTheAddressInTheListCanMintThatFid() public {
        bytes32[][] memory proofs = publishDayOne();
        vm.prank(buyer);
        vm.expectRevert(Fatliners.NotOnTodaysList.selector);
        nft.mint(18350, 1, DNA, proofs[0]);
        vm.prank(anky); // the right address, but a different history
        vm.expectRevert(Fatliners.NotOnTodaysList.selector);
        nft.mint(18350, 1, keccak256("another history"), proofs[0]);
    }

    function test_EachFidIsBornOnce() public {
        bytes32[][] memory proofs = publishDayOne();
        vm.startPrank(anky);
        nft.mint(18350, 1, DNA, proofs[0]);
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721InvalidSender.selector, address(0)));
        nft.mint(18350, 1, DNA, proofs[0]);
    }

    function test_ProofsOnlyWorkOnTheirDay_AndTheNextListGrows() public {
        bytes32[][] memory proofs = publishDayOne();
        vm.warp(block.timestamp + 1 days);
        vm.prank(anky);
        vm.expectRevert(Fatliners.NoRootToday.selector);
        nft.mint(18350, 1, DNA, proofs[0]);

        // Day two: a bigger list (here: anky and someone ranked lower). Yesterday's proof no longer works.
        bytes32 a = nft.leaf(18350, anky, 1, DNA);
        bytes32 b = nft.leaf(99999, late, 5000, keccak256("late"));
        vm.prank(publisher);
        nft.publishRoot(day1 + 1, hashPair(a, b), 7777, "https://fatline.ink/lists/day-2.json");
        vm.prank(anky);
        vm.expectRevert(Fatliners.NotOnTodaysList.selector);
        nft.mint(18350, 1, DNA, proofs[0]);
        bytes32[] memory p = new bytes32[](1);
        p[0] = a;
        vm.prank(late);
        nft.mint(99999, 5000, keccak256("late"), p);
        assertEq(nft.ownerOf(99999), late);
    }

    function test_RootsArePostedOnceByThePublisher_NeverForThePast() public {
        (bytes32 root,) = dayOneList();
        vm.expectRevert(Fatliners.NotPublisher.selector);
        nft.publishRoot(day1, root, 777, "");
        vm.startPrank(publisher);
        nft.publishRoot(day1, root, 777, "");
        vm.expectRevert(Fatliners.RootAlreadyPublished.selector);
        nft.publishRoot(day1, bytes32(uint256(1)), 777, "");
        vm.expectRevert(Fatliners.PastDay.selector);
        nft.publishRoot(day1 - 1, root, 777, "");
        nft.publishRoot(day1 + 1, root, 7777, ""); // tomorrow's list can be posted ahead
    }

    function test_NoMoreThanMaxSupply() public {
        Fatliners small = new Fatliners(1, publisher, IFatlineVaults(address(factory)), "");
        bytes32 a = small.leaf(18350, anky, 1, DNA);
        bytes32 b = small.leaf(3, dwr, 2, keccak256("dwr"));
        vm.prank(publisher);
        small.publishRoot(day1, hashPair(a, b), 2, "");
        bytes32[] memory p = new bytes32[](1);
        p[0] = b;
        vm.prank(anky);
        small.mint(18350, 1, DNA, p);
        p[0] = a;
        vm.prank(dwr);
        vm.expectRevert(Fatliners.SoldOut.selector);
        small.mint(3, 2, keccak256("dwr"), p);
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
        bytes32[][] memory proofs = publishDayOne();
        vm.prank(anky);
        nft.mint(18350, 1, DNA, proofs[0]);
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
        bytes32[][] memory proofs = publishDayOne();
        vm.prank(anky);
        nft.mint(18350, 1, DNA, proofs[0]);
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
        bytes32[][] memory proofs = publishDayOne();
        vm.prank(anky);
        nft.mint(18350, 1, DNA, proofs[0]);
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
