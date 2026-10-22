// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Fatliners} from "../src/Fatliners.sol";

contract FatlinersTest is Test {
    Fatliners nft;
    address admin = address(0xA11CE);
    uint256 attesterKey = 0xBEEF;
    address attester;
    address alice = address(0xA1);
    address bob = address(0xB0B);
    bytes32 constant RENDERER = keccak256("fatliners.render/1|fatliners.dna/1");
    bytes32 constant COMMIT = keccak256("history commitment");

    function setUp() public {
        attester = vm.addr(attesterKey);
        nft = new Fatliners(admin, attester);
    }

    function _sig(uint256 key, uint64 fid, address minter, uint64 snap, bytes32 commit, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "Mint(uint64 fid,address minter,uint64 snapshotAt,bytes32 commitment,bytes32 renderer,uint256 deadline)"
                ),
                fid,
                minter,
                snap,
                commit,
                RENDERER,
                deadline
            )
        );
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(key, keccak256(abi.encodePacked("\x19\x01", nft.DOMAIN_SEPARATOR(), structHash)));
        return abi.encodePacked(r, s, v);
    }

    function _mint(address who, uint64 fid) internal returns (uint256) {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sig(attesterKey, fid, who, 1_792_627_200_000, COMMIT, deadline);
        vm.prank(who);
        return nft.mint(fid, 1_792_627_200_000, COMMIT, RENDERER, deadline, sig);
    }

    function test_mint_records_origin() public {
        uint256 id = _mint(alice, 18350);
        assertEq(id, 1);
        assertEq(nft.ownerOf(1), alice);
        assertEq(nft.tokenOfFid(18350), 1);
        Fatliners.Origin memory o = nft.origin(1);
        assertEq(o.fid, 18350);
        assertEq(o.minter, alice);
        assertEq(o.commitment, COMMIT);
        assertEq(o.renderer, RENDERER);
    }

    function test_transfer_never_rewrites_origin() public {
        _mint(alice, 18350);
        vm.prank(alice);
        nft.transferFrom(alice, bob, 1);
        assertEq(nft.ownerOf(1), bob);
        Fatliners.Origin memory o = nft.origin(1);
        assertEq(o.fid, 18350);
        assertEq(o.minter, alice); // still the original minter
    }

    function test_one_birth_per_fid_even_after_sale() public {
        _mint(alice, 18350);
        vm.prank(alice);
        nft.transferFrom(alice, bob, 1);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sig(attesterKey, 18350, alice, 1, keccak256("newer history"), deadline);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Fatliners.AlreadyBorn.selector, uint64(18350), uint256(1)));
        nft.mint(18350, 1, keccak256("newer history"), RENDERER, deadline, sig);
    }

    function test_signature_is_bound_to_the_minter() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sig(attesterKey, 7, alice, 1, COMMIT, deadline);
        vm.prank(bob); // bob replays alice's attestation
        vm.expectRevert(Fatliners.BadSignature.selector);
        nft.mint(7, 1, COMMIT, RENDERER, deadline, sig);
    }

    function test_signature_is_bound_to_the_commitment() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sig(attesterKey, 7, alice, 1, COMMIT, deadline);
        vm.prank(alice);
        vm.expectRevert(Fatliners.BadSignature.selector);
        nft.mint(7, 1, keccak256("a prettier history"), RENDERER, deadline, sig);
    }

    function test_wrong_attester_and_expiry() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sig(0xBAD, 7, alice, 1, COMMIT, deadline);
        vm.prank(alice);
        vm.expectRevert(Fatliners.BadSignature.selector);
        nft.mint(7, 1, COMMIT, RENDERER, deadline, sig);

        sig = _sig(attesterKey, 7, alice, 1, COMMIT, deadline);
        vm.warp(deadline + 1);
        vm.prank(alice);
        vm.expectRevert(Fatliners.Expired.selector);
        nft.mint(7, 1, COMMIT, RENDERER, deadline, sig);
    }

    function test_exactly_777() public {
        for (uint64 fid = 1; fid <= 777; fid++) {
            _mint(address(uint160(0x1000 + fid)), fid);
        }
        assertEq(nft.totalSupply(), 777);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sig(attesterKey, 778, alice, 1, COMMIT, deadline);
        vm.prank(alice);
        vm.expectRevert(Fatliners.SoldOut.selector);
        nft.mint(778, 1, COMMIT, RENDERER, deadline, sig);
    }

    function test_mint_is_not_payable() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sig(attesterKey, 9, alice, 1, COMMIT, deadline);
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool ok,) = address(nft).call{value: 1 wei}(
            abi.encodeCall(Fatliners.mint, (uint64(9), uint64(1), COMMIT, RENDERER, deadline, sig))
        );
        assertFalse(ok);
        assertEq(address(nft).balance, 0);
    }

    function test_metadata_freeze_and_admin() public {
        _mint(alice, 1);
        vm.prank(admin);
        nft.setBaseURI("ipfs://cid/");
        assertEq(nft.tokenURI(1), "ipfs://cid/1");
        vm.prank(admin);
        nft.freezeMetadata();
        vm.prank(admin);
        vm.expectRevert(Fatliners.Frozen.selector);
        nft.setBaseURI("https://changed/");
        vm.prank(alice);
        vm.expectRevert(Fatliners.NotAdmin.selector);
        nft.setAttester(alice);
    }

    function test_approvals() public {
        _mint(alice, 1);
        vm.prank(bob);
        vm.expectRevert(Fatliners.NotAuthorized.selector);
        nft.transferFrom(alice, bob, 1);
        vm.prank(alice);
        nft.approve(bob, 1);
        vm.prank(bob);
        nft.transferFrom(alice, bob, 1);
        assertEq(nft.ownerOf(1), bob);
        assertEq(nft.getApproved(1), address(0));
    }
}
