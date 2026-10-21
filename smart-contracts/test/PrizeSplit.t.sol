// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {PrizeSplit} from "../src/PrizeSplit.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract PrizeSplitTest is Test {
    PrizeSplit split;
    MockUSDC usdc;
    address jp = makeAddr("jp");
    address friend = makeAddr("friend");
    address stranger = makeAddr("stranger");

    function setUp() public {
        split = new PrizeSplit(jp, friend);
        usdc = new MockUSDC();
    }

    function test_SplitsTokensInHalf() public {
        usdc.mint(address(split), 2_048e6);
        split.release(address(usdc), jp);
        split.release(address(usdc), friend);
        assertEq(usdc.balanceOf(jp), 1_024e6);
        assertEq(usdc.balanceOf(friend), 1_024e6);
    }

    function test_OneClaimingDoesNotBlockOrShortTheOther() public {
        usdc.mint(address(split), 100e6);
        split.release(address(usdc), jp);
        usdc.mint(address(split), 100e6); // a second payment arrives later
        split.release(address(usdc), jp);
        assertEq(usdc.balanceOf(jp), 100e6);
        assertEq(split.due(address(usdc), friend), 100e6);
        split.release(address(usdc), friend);
        assertEq(usdc.balanceOf(friend), 100e6);
    }

    function test_SplitsEth() public {
        vm.deal(stranger, 3 ether);
        vm.prank(stranger);
        (bool ok,) = address(split).call{value: 3 ether}("");
        assertTrue(ok);
        split.release(address(0), friend);
        assertEq(friend.balance, 1.5 ether);
        assertEq(split.due(address(0), jp), 1.5 ether);
    }

    function test_RevertWhen_NotPayee() public {
        usdc.mint(address(split), 10);
        vm.expectRevert(PrizeSplit.NotPayee.selector);
        split.release(address(usdc), stranger);
    }

    function test_RevertWhen_NothingDue() public {
        vm.expectRevert(PrizeSplit.NothingDue.selector);
        split.release(address(usdc), jp);
    }

    function test_RevertWhen_SamePerson() public {
        vm.expectRevert(PrizeSplit.SamePerson.selector);
        new PrizeSplit(jp, jp);
    }

    function testFuzz_NeverPaysMoreThanReceived(uint64 x, uint64 y, bool order) public {
        usdc.mint(address(split), x);
        if (split.due(address(usdc), order ? jp : friend) > 0) split.release(address(usdc), order ? jp : friend);
        usdc.mint(address(split), y);
        if (split.due(address(usdc), jp) > 0) split.release(address(usdc), jp);
        if (split.due(address(usdc), friend) > 0) split.release(address(usdc), friend);
        uint256 total = uint256(x) + y;
        assertEq(usdc.balanceOf(jp), total / 2);
        assertEq(usdc.balanceOf(friend), total / 2);
    }
}
