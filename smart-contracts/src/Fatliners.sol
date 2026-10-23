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
/// Who may mint changes every day. Each day the publisher posts the root of a Merkle tree (a public
/// fingerprint) of that day's list: on day one the top 777 accounts of the open ranking, on day two
/// the top 7,777, and so on, each leaf holding the account's FID, the address that may mint it, its
/// rank and a hash of its history (its DNA). The list and the code that makes it are public, so
/// anyone can rebuild the tree and check the root. A root can be posted once per day and never
/// changed. A proof only works against today's root.
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
    address public immutable publisher; // posts each day's root; cannot change past days
    IFatlineVaults public immutable vaults; // the factory that gives each Fatliner its vault
    string internal baseUri;

    uint256 public totalSupply;
    mapping(uint256 day => bytes32) public rootOf;
    mapping(uint256 day => uint256) public eligibleOn; // how many accounts that day's list holds
    mapping(uint256 fid => bytes32) public dnaOf; // the history hash at mint: what the being hatches from
    mapping(uint256 fid => uint256) public rankOf;

    event RootPublished(uint256 indexed day, bytes32 root, uint256 eligible, string list);
    event Born(uint256 indexed fid, address indexed to, uint256 rank, bytes32 dna, uint256 day);

    error NotPublisher();
    error RootAlreadyPublished();
    error PastDay();
    error NoRootToday();
    error NotOnTodaysList();
    error SoldOut();
    error ZeroAddress();

    constructor(
        uint256 maxSupply_,
        address publisher_,
        IFatlineVaults vaults_,
        string memory baseUri_
    ) ERC721("Fatliners", "FATLINER") {
        if (publisher_ == address(0) || address(vaults_) == address(0)) revert ZeroAddress();
        maxSupply = maxSupply_;
        publisher = publisher_;
        vaults = vaults_;
        baseUri = baseUri_;
    }

    function today() public view returns (uint256) {
        return block.timestamp / 1 days;
    }

    /// @notice Post a day's list. `list` is where anyone can download it (and the code that made it).
    function publishRoot(uint256 day, bytes32 root, uint256 eligible, string calldata list) external {
        if (msg.sender != publisher) revert NotPublisher();
        if (day < today()) revert PastDay();
        if (rootOf[day] != bytes32(0)) revert RootAlreadyPublished();
        rootOf[day] = root;
        eligibleOn[day] = eligible;
        emit RootPublished(day, root, eligible, list);
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
        emit Born(fid, msg.sender, rank, dna, today());
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
