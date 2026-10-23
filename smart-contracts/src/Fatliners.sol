// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

interface IFatlineVaults {
    function predictFatlinerVault(uint256 fid) external view returns (address);
}

/// @title Fatliners
/// @notice 777 beings, each born from one Farcaster account. The token id is the account's FID:
/// you are your FID.
///
/// Who may mint changes every day. The day's list (on day one the top 777 accounts of the open
/// ranking, on day two the top 7,777, and so on) is a Merkle tree, each leaf holding the account's FID,
/// the address that may mint it, its rank and a hash of its history (its DNA).
///
/// Nobody posts the list alone. A fixed group of attesters, people who run their own Farcaster nodes,
/// each compute the list with the same public code and vote for its root. The ranking is
/// deterministic, so honest attesters get the same root. A root becomes the day's list when more than
/// half of the attesters voted for it (half rounded down, plus one): two different roots can never
/// both get there. Without a majority there is no mint that day. An agreed root never changes, and a
/// proof only works against today's root.
///
/// The keeper link: a Fatliner is born from one account (its origin, which never changes), and is
/// kept by whoever holds it. The holder links the FID they live on Farcaster through; the link is
/// cleared on every transfer, so a new holder brings their own frame of reference. The contract
/// records which FID the holder claims; readers check, on a node, that the holder's address belongs
/// to that FID (as its custody or a verified address) before they trust it.
///
/// Minting is free. When all 777 exist, no more can be made.
///
/// Resales: 8% royalty (ERC-2981) to the Fatliner's own vault, as fuel for its node. The vault's
/// address is known before the vault exists, so royalties are never lost. Marketplaces read ERC-2981
/// and usually pay it; it is not enforced on transfers, so gifts and moves between your own wallets
/// stay free.
contract Fatliners is ERC721, IERC2981 {
    uint256 public constant ROYALTY_BPS = 800; // 8%

    uint256 public immutable maxSupply;
    address[] internal _attesters;
    mapping(address => bool) public isAttester;
    uint256 public immutable threshold; // more than half of the attesters
    IFatlineVaults public immutable vaults; // the factory that gives each Fatliner its vault
    string internal baseUri;

    uint256 public totalSupply;
    mapping(uint256 day => bytes32) public rootOf;
    mapping(uint256 day => uint256) public eligibleOn; // how many accounts that day's list holds
    mapping(uint256 fid => bytes32) public dnaOf; // the history hash at mint: what the being hatches from
    mapping(uint256 fid => uint256) public rankOf;
    mapping(uint256 day => mapping(address attester => bool)) public voted;
    mapping(uint256 day => mapping(bytes32 vote => uint256)) public votesFor; // vote = hash(root, eligible)
    mapping(uint256 fid => uint256) public linkedFidOf; // the keeper link: the FID its holder lives through

    event Attested(uint256 indexed day, address indexed attester, bytes32 root, uint256 eligible, string list);
    event RootAgreed(uint256 indexed day, bytes32 root, uint256 eligible, uint256 votes);
    event FidLinked(uint256 indexed fatliner, uint256 indexed fid, address indexed holder);
    event Born(uint256 indexed fid, address indexed to, uint256 rank, bytes32 dna, uint256 day);

    error NotAttester();
    error AlreadyVoted();
    error NoAttesters();
    error DuplicateAttester();
    error NotHolder();
    error PastDay();
    error NoRootToday();
    error NotOnTodaysList();
    error SoldOut();
    error ZeroAddress();

    constructor(
        uint256 maxSupply_,
        address[] memory attesters_,
        IFatlineVaults vaults_,
        string memory baseUri_
    ) ERC721("Fatliners", "FATLINER") {
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

    function today() public view returns (uint256) {
        return block.timestamp / 1 days;
    }

    function attesters() external view returns (address[] memory) {
        return _attesters;
    }

    /// @notice An attester's vote for a day's list. `list` is where anyone can download what they computed.
    /// One vote per attester per day. The first root to get more than half of the votes becomes the list.
    function attest(uint256 day, bytes32 root, uint256 eligible, string calldata list) external {
        if (!isAttester[msg.sender]) revert NotAttester();
        if (day < today()) revert PastDay();
        if (voted[day][msg.sender]) revert AlreadyVoted();
        voted[day][msg.sender] = true;
        bytes32 vote = keccak256(abi.encode(root, eligible));
        uint256 votes = ++votesFor[day][vote];
        emit Attested(day, msg.sender, root, eligible, list);
        if (votes == threshold && rootOf[day] == bytes32(0)) {
            rootOf[day] = root;
            eligibleOn[day] = eligible;
            emit RootAgreed(day, root, eligible, votes);
        }
    }

    /// @notice The leaf for one account, as the list builder hashes it (double-hashed, OpenZeppelin style).
    function leaf(uint256 fid, address account, uint256 rank, bytes32 dna) public pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(fid, account, rank, dna))));
    }

    /// @notice Be born. Called by the address named in today's list for this FID. Free.
    function mint(uint256 fid, uint256 rank, bytes32 dna, bytes32[] calldata proof) external {
        bytes32 root = rootOf[today()];
        if (root == bytes32(0)) revert NoRootToday();
        if (!MerkleProof.verifyCalldata(proof, root, leaf(fid, msg.sender, rank, dna))) revert NotOnTodaysList();
        if (totalSupply >= maxSupply) revert SoldOut();
        totalSupply++;
        dnaOf[fid] = dna;
        rankOf[fid] = rank;
        _mint(msg.sender, fid); // reverts if this FID was already born
        linkedFidOf[fid] = fid; // at birth, its holder is its origin
        emit Born(fid, msg.sender, rank, dna, today());
        emit FidLinked(fid, fid, msg.sender);
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
