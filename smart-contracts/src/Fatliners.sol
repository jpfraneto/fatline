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
/// A Fatliner hatches from an egg, and the egg is kept warm by a Fatline server: a machine running a
/// Farcaster node, a client and a hatchery. To lay one, the account signs a claim with its app key: "this
/// server keeps my egg warm; hatch me to this address". The attesters' hatcheries then check that server
/// every hour, by themselves: does its node answer, is it in sync, does it hold real messages, does its
/// hatchery answer? A day is warm when most of its checks pass. After three warm days each attester signs
/// an EIP-712 Hatch, and anyone can bring the signatures here.
///
/// It all starts from one Fatliner: the genesis Fatliner (Aster, $FATLINE), born when this contract is
/// deployed, and the server that keeps it alive, the genesis attester. Every other Fatliner hatches.
///
/// Attesters are Fatline servers that hatched. When an egg hatches, the server that kept it warm becomes
/// an attester (its hatchery key and address are part of the Hatch). Nobody adds or removes attesters:
/// the only way in is three days of a real node, checked by the servers already in. The genesis server
/// is the only exception, because the first egg needs someone to check it. A Hatch needs signatures from REQUIRED attesters, or from all of them while
/// there are fewer.
///
/// The Hatch carries the egg's DNA: a hash of the account's history up to the hour the egg was laid
/// (fatliners/src/history.mjs commitment()), computed by each attester on its own node. The being is
/// drawn from that history, and anyone holding those messages can check it.
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
/// Resales: 8% royalty (ERC-2981) on every Fatliner, to the genesis Fatliner's vault: the system feeds
/// the one it starts from. The vault's address is known before the vault exists, so royalties are never lost. Marketplaces read ERC-2981
/// and usually pay it; it is not enforced on transfers, so gifts and moves between your own wallets
/// stay free.
contract Fatliners is ERC721, IERC2981, EIP712 {
    uint256 public constant ROYALTY_BPS = 800; // 8%
    uint256 public constant WARM_DAYS = 3; // what attesters wait for before they sign; written here so anyone can see it
    uint256 public constant REQUIRED = 3; // signatures a Hatch needs (or all attesters, while there are fewer)

    /// @dev fid: the account. to: who it is born to. dna: the history commitment when the egg was laid.
    /// laidAt: when the egg was laid (unix seconds, the history's cutoff). deadline: the Hatch expires.
    /// server: the hatchery key of the server that kept the egg warm; it becomes an attester. url: where
    /// that hatchery answers.
    bytes32 public constant HATCH_TYPEHASH = keccak256(
        "Hatch(uint256 fid,address to,bytes32 dna,uint64 laidAt,uint256 deadline,address server,string url)"
    );

    struct Hatch {
        uint256 fid;
        address to;
        bytes32 dna;
        uint64 laidAt;
        uint256 deadline;
        address server;
        string url;
    }

    uint256 public immutable maxSupply;
    uint256 public immutable genesisFid; // the Fatliner it all starts from; every royalty goes to its vault
    address[] internal _attesters;
    mapping(address => bool) public isAttester;
    mapping(address => string) public urlOf; // where each attester's hatchery answers
    mapping(address => uint256) public fidOfAttester; // the Fatliner its server hatched (0: genesis)
    IFatlineVaults public immutable vaults; // the factory that gives each Fatliner its vault
    string internal baseUri;

    uint256 public totalSupply;
    mapping(uint256 fid => bytes32) public dnaOf; // the history hash the being hatched from
    mapping(uint256 fid => uint64) public laidAtOf; // the moment that history was frozen
    mapping(uint256 fid => address) public serverOf; // the server that kept its egg warm
    mapping(uint256 fid => uint256) public linkedFidOf; // the keeper link: the FID its holder lives through

    event AttesterJoined(address indexed attester, uint256 indexed fid, string url);
    event UrlChanged(address indexed attester, string url);
    event FidLinked(uint256 indexed fatliner, uint256 indexed fid, address indexed holder);
    event Born(uint256 indexed fid, address indexed to, bytes32 dna, uint64 laidAt, address server, uint256 signers);

    error NotHolder();
    error NotAttester(address signer);
    error AlreadyAttester();
    error Expired();
    error NotEnoughAttesters();
    error SignersNotSorted(); // each attester once: signatures ordered by signer address, ascending
    error SoldOut();
    error ZeroAddress();

    /// @param genesis      the genesis server's hatchery key: the first attester
    /// @param genesisUrl   where its hatchery answers
    /// @param genesisFid_  the genesis Fatliner, born here to `genesisTo` with `genesisDna` (history up to `genesisLaidAt`)
    constructor(
        uint256 maxSupply_,
        address genesis,
        string memory genesisUrl,
        uint256 genesisFid_,
        address genesisTo,
        bytes32 genesisDna,
        uint64 genesisLaidAt,
        IFatlineVaults vaults_,
        string memory baseUri_
    ) ERC721("Fatliners", "FATLINER") EIP712("Fatliners", "1") {
        if (genesis == address(0) || genesisTo == address(0) || address(vaults_) == address(0)) revert ZeroAddress();
        maxSupply = maxSupply_;
        vaults = vaults_;
        baseUri = baseUri_;
        genesisFid = genesisFid_;
        totalSupply = 1;
        dnaOf[genesisFid_] = genesisDna;
        laidAtOf[genesisFid_] = genesisLaidAt;
        serverOf[genesisFid_] = genesis;
        _mint(genesisTo, genesisFid_);
        linkedFidOf[genesisFid_] = genesisFid_;
        _join(genesis, genesisFid_, genesisUrl);
        emit Born(genesisFid_, genesisTo, genesisDna, genesisLaidAt, genesis, 0);
        emit FidLinked(genesisFid_, genesisFid_, genesisTo);
    }

    function _join(address a, uint256 fid, string memory url) internal {
        isAttester[a] = true;
        urlOf[a] = url;
        fidOfAttester[a] = fid;
        _attesters.push(a);
        emit AttesterJoined(a, fid, url);
    }

    function attesters() external view returns (address[] memory) {
        return _attesters;
    }

    /// @notice Every attester and where its hatchery answers: what a Fatline server reads to find the others.
    function hatcheries() external view returns (address[] memory who, string[] memory urls) {
        who = _attesters;
        urls = new string[](who.length);
        for (uint256 i; i < who.length; i++) urls[i] = urlOf[who[i]];
    }

    /// @notice How many signatures a Hatch needs right now.
    function threshold() public view returns (uint256) {
        return _attesters.length < REQUIRED ? _attesters.length : REQUIRED;
    }

    /// @notice An attester moves its hatchery.
    function setUrl(string calldata url) external {
        if (!isAttester[msg.sender]) revert NotAttester(msg.sender);
        urlOf[msg.sender] = url;
        emit UrlChanged(msg.sender, url);
    }

    /// @notice What an attester signs (EIP-712) when an egg hatches.
    function hatchDigest(Hatch calldata h) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(HATCH_TYPEHASH, h.fid, h.to, h.dna, h.laidAt, h.deadline, h.server, keccak256(bytes(h.url))))
        );
    }

    /// @notice Be born. Anyone may submit it; the Fatliner goes to `h.to`, and the server that kept the egg
    /// warm becomes an attester. Free. `signatures` come from attesters, ordered by their address (lowest first).
    function hatch(Hatch calldata h, bytes[] calldata signatures) external {
        if (block.timestamp > h.deadline) revert Expired();
        if (h.to == address(0) || h.server == address(0)) revert ZeroAddress();
        if (isAttester[h.server]) revert AlreadyAttester(); // one server, one egg
        if (signatures.length < threshold()) revert NotEnoughAttesters();
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
        serverOf[h.fid] = h.server;
        _mint(h.to, h.fid); // reverts if this FID was already born
        linkedFidOf[h.fid] = h.fid; // at birth, its holder is its origin
        _join(h.server, h.fid, h.url);
        emit Born(h.fid, h.to, h.dna, h.laidAt, h.server, signatures.length);
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

    /// @notice Every resale pays the genesis Fatliner's vault.
    function royaltyInfo(uint256, uint256 salePrice) external view returns (address, uint256) {
        return (vaults.predictFatlinerVault(genesisFid), (salePrice * ROYALTY_BPS) / 10_000);
    }

    function tokenURI(uint256 fid) public view override returns (string memory) {
        _requireOwned(fid);
        return string.concat(baseUri, Strings.toString(fid));
    }

    function supportsInterface(bytes4 id) public view override(ERC721, IERC165) returns (bool) {
        return id == type(IERC2981).interfaceId || super.supportsInterface(id);
    }
}
