// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Voices} from "../src/Voices.sol";

contract VoicesTest is Test {
    Voices voices;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    event Voice(
        uint256 indexed id, address indexed author, uint256 indexed parentId, uint256 fid, string text
    );
    event Retracted(uint256 indexed id, address indexed author);

    function setUp() public {
        voices = new Voices();
    }

    function test_SayLongerThanACast() public {
        string memory text = string(new bytes(5_000));
        vm.expectEmit(address(voices));
        emit Voice(1, alice, 0, 16098, text);
        vm.prank(alice);
        uint256 id = voices.say(text, 0, 16098);
        assertEq(id, 1);
        assertEq(voices.count(), 1);
        assertEq(voices.authorOf(1), alice);
    }

    function test_Reply() public {
        vm.prank(alice);
        voices.say("first", 0, 0);
        vm.prank(bob);
        assertEq(voices.say("reply", 1, 0), 2);
    }

    function test_RevertWhen_Empty() public {
        vm.expectRevert(Voices.Empty.selector);
        voices.say("", 0, 0);
    }

    function test_RevertWhen_TooLong() public {
        string memory text = string(new bytes(16_385));
        vm.expectRevert(abi.encodeWithSelector(Voices.TooLong.selector, 16_385));
        voices.say(text, 0, 0);
    }

    function test_MaxLengthIsAllowed() public {
        voices.say(string(new bytes(16_384)), 0, 0);
    }

    function test_RevertWhen_ParentUnknown() public {
        vm.expectRevert(abi.encodeWithSelector(Voices.UnknownParent.selector, 7));
        voices.say("reply to nothing", 7, 0);
    }

    function test_Retract() public {
        vm.prank(alice);
        voices.say("i changed my mind", 0, 0);

        vm.prank(bob);
        vm.expectRevert(Voices.NotAuthor.selector);
        voices.retract(1);

        vm.expectEmit(address(voices));
        emit Retracted(1, alice);
        vm.prank(alice);
        voices.retract(1);
        assertTrue(voices.retracted(1));

        vm.prank(alice);
        vm.expectRevert(Voices.AlreadyRetracted.selector);
        voices.retract(1);
    }
}
