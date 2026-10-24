// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

interface IFatlineVaults {
    function predictFatlinerVault(uint256 fid) external view returns (address);
}

/// @title Fatliners
/// @notice 777 beings, each born from one Farcaster account. The token id is the account's FID:
/// you are your FID.
///
/// A Fatliner hatches from an egg, and the egg is kept warm by a Farcaster node. To lay one, the
/// account signs a claim with its app key: "this node is mine, hatch me to this address". Attesters,
/// people who run their own nodes, then check that node every hour: does it answer, is it in sync,
/// does it hold real messages? A day is warm when most of its checks pass. After three warm days the
/// egg hatches: each attester signs an EIP-712 Hatch for it, and anyone can bring the signatures here.
/// It is born when more than half of the attesters signed the same Hatch (half rounded down, plus one).
///
/// The Hatch carries the egg's DNA: a hash of the account's history up to the moment the egg was laid
/// (fatliners/src/history.mjs commitment()). The being is drawn from that history, and anyone holding
/// those messages can check it.
///
/// The keeper link: a Fatliner is born from one account (its origin, which never changes), and is
/// kept by whoever holds it. The holder links the FID they live on Farcaster through; the link is
/// cleared on every transfer, so a new holder brings their own frame of reference. The contract
/// records which FID the holder claims; readers check, on a node, that the holder's address belongs
/// to that FID (as its custody or a verified address) before they trust it.
///
/// Minting is free, and whoever submits it pays the gas, not necessarily the one it is born to.
/// When all 777 exist, no more can be made.
///
/// Resales: 8% royalty (ERC-2981) to the Fatliner's own vault, as fuel for its node. The vault's
/// address is known before the vault exists, so royalties are never lost. Marketplaces read ERC-2981
/// and usually pay it; it is not enforced on transfers, so gifts and moves between your own wallets
/// stay free.
contract Fatliners is ERC721, IERC2981, EIP712 {
    uint256 public constant ROYALTY_BPS = 800; // 8%
    uint256 public constant WARM_DAYS = 3; // what attesters wait for before they sign; written here so anyone can see it

    /// @dev fid: the account. to: who it is born to. dna: the history commitment when the egg was laid.
    /// laidAt: when the egg was laid (unix seconds, the history's cutoff). deadline: the Hatch expires.
    bytes32 public constant HATCH_TYPEHASH =
        keccak256("Hatch(uint256 fid,address to,bytes32 dna,uint64 laidAt,uint256 deadline)");

    struct Hatch {
        uint256 fid;
        address to;
        bytes32 dna;
        uint64 laidAt;
        uint256 deadline;
    }

    uint256 public immutable maxSupply;
    address[] internal _attesters;
    mapping(address => bool) public isAttester;
    uint256 public immutable threshold; // more than half of the attesters
    IFatlineVaults public immutable vaults; // the factory that gives each Fatliner its vault
    string internal baseUri;

    uint256 public totalSupply;
    mapping(uint256 fid => bytes32) public dnaOf; // the history hash the being hatched from
    mapping(uint256 fid => uint64) public laidAtOf; // the moment that history was frozen
    mapping(uint256 fid => uint256) public linkedFidOf; // the keeper link: the FID its holder lives through

    event FidLinked(uint256 indexed fatliner, uint256 indexed fid, address indexed holder);
    event Born(uint256 indexed fid, address indexed to, bytes32 dna, uint64 laidAt, uint256 signers);

    error NoAttesters();
    error DuplicateAttester();
    error NotHolder();
    error Expired();
    error NotEnoughAttesters();
    error SignersNotSorted(); // each attester once: signatures ordered by signer address, ascending
    error NotAttester(address signer);
    error SoldOut();
    error ZeroAddress();

    constructor(
        uint256 maxSupply_,
        address[] memory attesters_,
        IFatlineVaults vaults_,
        string memory baseUri_
    ) ERC721("Fatliners", "FATLINER") EIP712("Fatliners", "1") {
        if (attesters_.length == 0) revert NoAttesters();
        if (address(vaults_) == address(0)) revert ZeroAddress();
        for (uint256 i; i < attesters_.length; i++) {
            address a = attesters_[i];
            if (a == address(0)) revert ZeroAddress();
            if (isAttester[a]) revert DuplicateAttester();
            isAttester[a] = true;
            _attesters.push(a);
        }
        threshold = attesters_.length / 2 + 1;
        maxSupply = maxSupply_;
        vaults = vaults_;
        baseUri = baseUri_;
    }

    function attesters() external view returns (address[] memory) {
        return _attesters;
    }

    /// @notice What an attester signs (EIP-712) when an egg hatches.
    function hatchDigest(Hatch calldata h) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(HATCH_TYPEHASH, h.fid, h.to, h.dna, h.laidAt, h.deadline)));
    }

    /// @notice Be born. Anyone may submit it; the Fatliner goes to `h.to`. Free.
    /// `signatures` come from attesters, ordered by their address (lowest first), more than half of them.
    function hatch(Hatch calldata h, bytes[] calldata signatures) external {
        if (block.timestamp > h.deadline) revert Expired();
        if (h.to == address(0)) revert ZeroAddress();
        if (signatures.length < threshold) revert NotEnoughAttesters();
        bytes32 digest = hatchDigest(h);
        address last;
        for (uint256 i; i < signatures.length; i++) {
            address signer = ECDSA.recover(digest, signatures[i]);
            if (signer <= last) revert SignersNotSorted();
            if (!isAttester[signer]) revert NotAttester(signer);
            last = signer;
        }
        if (totalSupply >= maxSupply) revert SoldOut();
        totalSupply++;
        dnaOf[h.fid] = h.dna;
        laidAtOf[h.fid] = h.laidAt;
        _mint(h.to, h.fid); // reverts if this FID was already born
        linkedFidOf[h.fid] = h.fid; // at birth, its holder is its origin
        emit Born(h.fid, h.to, h.dna, h.laidAt, signatures.length);
        emit FidLinked(h.fid, h.fid, h.to);
    }

    /// @notice The keeper link: the holder says which FID they live on Farcaster through.
    /// 0 removes the link. Readers check on a node that the holder's address belongs to `fid`.
    function linkFid(uint256 fatliner, uint256 fid) external {
        if (ownerOf(fatliner) != msg.sender) revert NotHolder();
        linkedFidOf[fatliner] = fid;
        emit FidLinked(fatliner, fid, msg.sender);
    }

    /// @dev A new holder brings their own frame of reference: the link is cleared on every transfer.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address from) {
        from = super._update(to, tokenId, auth);
        if (from != address(0) && from != to && linkedFidOf[tokenId] != 0) {
            delete linkedFidOf[tokenId];
            emit FidLinked(tokenId, 0, to);
        }
    }

    function royaltyInfo(uint256 fid, uint256 salePrice) external view returns (address, uint256) {
        return (vaults.predictFatlinerVault(fid), (salePrice * ROYALTY_BPS) / 10_000);
    }

    function tokenURI(uint256 fid) public view override returns (string memory) {
        _requireOwned(fid);
        return string.concat(baseUri, Strings.toString(fid));
    }

    function supportsInterface(bytes4 id) public view override(ERC721, IERC165) returns (bool) {
        return id == type(IERC2981).interfaceId || super.supportsInterface(id);
    }
}
