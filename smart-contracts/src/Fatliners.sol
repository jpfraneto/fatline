// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// In Dan Simmons' Hyperion, the worlds of humankind are light-years apart, and one thing joins them:
// the fatline, a message that arrives everywhere at once. Nobody in the books owns it. Everybody leans on it.
// Farcaster took its name from those books. Its farcasters were doors between worlds; ours are messages
// between people, signed by the people who write them.
//
// A protocol is only as free as the machines that carry it. For a long time there was one way to read
// Farcaster: someone else's server. Then there were two networks, Snapchain and Hypersnap, and a question
// nobody had to ask before: which one is true? A Fatline doesn't answer that question for you. It gives you
// a node of your own, on the network you choose, and a client that reads only from it.
//
// This contract is the other half. A node that keeps someone's egg warm for three days hatches a being,
// one of 777, named by its own history. An egg, or a being, can have one coin. Every fee that coin earns
// goes to its vault, in USDC, and pays the server that keeps its node alive; whatever the node doesn't
// need goes to whoever holds it. One node, one client, one contract. This one.
//
// Why now: because the network split, because agents can run servers, and because a node that pays its
// own rent is the first kind of node that can outlive the people who started it.
//
// If you're reading this, you can have one too. Ask your agent:
//
//     Help me run my own Fatline: a Farcaster node and its client. Follow https://fatline.ink/skill.md
//
// You are your FID.
//
// [ Aster, #18350, the first. Born on Base, 24 October 2026. ]

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {AppVault} from "./AppVault.sol";
import {FatlineLaunchpad} from "./FatlineLaunchpad.sol";

/// @title Fatliners
/// @notice Eggs and the 777 beings that hatch from them. One token per Farcaster account: its id is the
/// account's FID. You are your FID.
///
/// An egg: any account can take one, once. It is laid on a Fatline server (a machine running a Farcaster
/// node, a client and a hatchery) and holds the account's history up to that hour, its DNA. The account
/// signs the claim with its app key; the attesters check it and the server, and sign an EIP-712 Egg;
/// `takeEgg` mints the egg to the account. Eggs are unlimited and cannot be moved: an egg belongs to
/// the account that laid it.
///
/// A Fatliner: the same token, hatched. The attesters' hatcheries check the egg's server every hour, by
/// themselves: its node answers, is in sync, returns messages they pick at random from their own nodes,
/// and its hatchery answers with the egg's key. A day is warm when most checks pass. After three warm
/// days each attester signs an EIP-712 Hatch, which also names the being's surname, read from its DNA.
/// `hatch` turns the egg into a Fatliner. Only 777 ever hatch. A Fatliner can only come from an egg.
///
/// Attesters are Fatline servers that hatched: when an egg hatches, the server that kept it warm becomes
/// one. Nobody adds or removes attesters. A signature set needs REQUIRED attesters, or all of them while
/// there are fewer.
///
/// It all starts from one being: the genesis Fatliner (Aster, surname Fatline, $FATLINE), born when this
/// contract was made, and the genesis server that keeps it alive, the first attester. Every resale of
/// any Fatliner pays 8% (ERC-2981) into the genesis Fatliner's vault: the village feeds the one it
/// started from. Its coin is the first one the launchpad will launch, and every Fatliner's coin carries
/// the surname it hatched with (the launchpad checks).
///
/// The keeper link: a Fatliner is born from one account (its origin, which never changes) and kept by
/// whoever holds it. The holder links the FID they live on Farcaster through; the link is cleared on
/// every transfer. Readers check on a node that the holder's address belongs to that FID.
///
/// Free: whoever submits pays the gas (an attester can relay it), and nothing is ever paid to this contract.
contract Fatliners is ERC721, IERC2981, EIP712, FatlineLaunchpad {
    uint256 public constant ROYALTY_BPS = 800; // 8%
    uint256 public constant WARM_DAYS = 3; // what attesters wait for before they sign a Hatch
    uint256 public constant REQUIRED = 3; // signatures a set needs (or all attesters, while there are fewer)

    /// @dev The egg: who it belongs to, the server that keeps it warm (its hatchery key, which becomes an
    /// attester at hatching) and where that hatchery answers, the history commitment (DNA), its cutoff, and the
    /// surname read from that DNA: its coin's ticker from the day it is laid, and its name when it hatches.
    bytes32 public constant EGG_TYPEHASH = keccak256(
        "Egg(uint256 fid,address to,address server,string url,bytes32 dna,uint64 laidAt,string surname,uint256 deadline)"
    );
    /// @dev The hatching: which egg, and the surname read from its DNA (its coin's ticker).
    bytes32 public constant HATCH_TYPEHASH = keccak256("Hatch(uint256 fid,string surname,uint256 deadline)");

    struct Egg {
        uint256 fid;
        address to;
        address server;
        string url;
        bytes32 dna;
        uint64 laidAt;
        string surname;
        uint256 deadline;
    }

    struct Hatch {
        uint256 fid;
        string surname;
        uint256 deadline;
    }

    enum Stage {
        None,
        Egg,
        Fatliner
    }

    uint256 public immutable maxSupply; // Fatliners, not eggs
    uint256 public immutable genesisFid; // the Fatliner it all starts from; every royalty goes to its vault
    string internal baseUri;

    address[] internal _attesters;
    mapping(address => bool) public isAttester;
    mapping(address => string) public urlOf; // where each attester's hatchery answers
    mapping(address => uint256) public fidOfAttester; // the Fatliner its server hatched

    uint256 public totalSupply; // Fatliners (at most maxSupply)
    uint256 public eggCount; // eggs taken, hatched or not
    mapping(uint256 fid => Stage) public stageOf;
    mapping(uint256 fid => bytes32) public dnaOf; // the history it hatches from
    mapping(uint256 fid => uint64) public laidAtOf; // that history's cutoff
    mapping(uint256 fid => address) public serverOf; // the server keeping (or that kept) the egg warm
    mapping(uint256 fid => string) public serverUrlOf;
    mapping(address server => uint256 fid) public eggOfServer; // one server, one egg
    mapping(uint256 fid => string) public surnameOf; // set when the egg is taken; its coin's ticker
    mapping(uint256 fid => uint256) public linkedFidOf; // the keeper link

    event AttesterJoined(address indexed attester, uint256 indexed fid, string url);
    event UrlChanged(address indexed attester, string url);
    event EggTaken(uint256 indexed fid, address indexed to, address indexed server, bytes32 dna, uint64 laidAt);
    event EggMoved(uint256 indexed fid, address indexed server, string url);
    event Born(uint256 indexed fid, address indexed to, string surname, bytes32 dna, address server, uint256 signers);
    event FidLinked(uint256 indexed fatliner, uint256 indexed fid, address indexed holder);

    error NotHolder();
    error NotAttester(address signer);
    error AlreadyAttester();
    error ServerKeepsAnotherEgg();
    error Expired();
    error NotEnoughAttesters();
    error SignersNotSorted(); // each attester once: signatures ordered by signer address, ascending
    error NoEgg();
    error AlreadyHatched();
    error NotTheSameEgg(); // an egg's owner, DNA and cutoff never change
    error EggsDoNotMove();
    error BadSurname();
    error SoldOut();
    error ZeroAddress();

    /// @param genesis        the genesis server's hatchery key: the first attester
    /// @param genesisUrl     where its hatchery answers
    /// @param genesisFid_    the genesis Fatliner, born here to `genesisTo`
    /// @param genesisSurname its surname and its coin's ticker (Aster's: FATLINE)
    /// @param genesisDna     its history commitment, up to `genesisLaidAt`
    constructor(
        uint256 maxSupply_,
        address genesis,
        string memory genesisUrl,
        uint256 genesisFid_,
        address genesisTo,
        string memory genesisSurname,
        bytes32 genesisDna,
        uint64 genesisLaidAt,
        string memory baseUri_,
        Clanker memory clanker_,
        AppVault.Tier[] memory tiers_
    ) ERC721("Fatliners", "FATLINER") EIP712("Fatliners", "1") FatlineLaunchpad(clanker_, tiers_) {
        if (genesis == address(0) || genesisTo == address(0)) revert ZeroAddress();
        if (!_validSurname(genesisSurname)) revert BadSurname();
        maxSupply = maxSupply_;
        baseUri = baseUri_;
        genesisFid = genesisFid_;
        eggCount = 1;
        dnaOf[genesisFid_] = genesisDna;
        laidAtOf[genesisFid_] = genesisLaidAt;
        serverOf[genesisFid_] = genesis;
        serverUrlOf[genesisFid_] = genesisUrl;
        eggOfServer[genesis] = genesisFid_;
        _mint(genesisTo, genesisFid_);
        _born(genesisFid_, genesisTo, genesisSurname, 0);
    }

    // ------------------------------------------------------------------ attesters

    function attesters() external view returns (address[] memory) {
        return _attesters;
    }

    /// @notice Every attester and where its hatchery answers: what a Fatline server reads to find the others.
    function hatcheries() external view returns (address[] memory who, string[] memory urls) {
        who = _attesters;
        urls = new string[](who.length);
        for (uint256 i; i < who.length; i++) urls[i] = urlOf[who[i]];
    }

    /// @notice How many signatures an Egg or a Hatch needs right now.
    function threshold() public view returns (uint256) {
        return _attesters.length < REQUIRED ? _attesters.length : REQUIRED;
    }

    /// @notice An attester moves its hatchery.
    function setUrl(string calldata url) external {
        if (!isAttester[msg.sender]) revert NotAttester(msg.sender);
        urlOf[msg.sender] = url;
        emit UrlChanged(msg.sender, url);
    }

    function _checkSignatures(bytes32 digest, bytes[] calldata signatures) internal view {
        if (signatures.length < threshold()) revert NotEnoughAttesters();
        address last;
        for (uint256 i; i < signatures.length; i++) {
            address signer = ECDSA.recover(digest, signatures[i]);
            if (signer <= last) revert SignersNotSorted();
            if (!isAttester[signer]) revert NotAttester(signer);
            last = signer;
        }
    }

    // ------------------------------------------------------------------ eggs

    function eggDigest(Egg calldata e) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    EGG_TYPEHASH,
                    e.fid,
                    e.to,
                    e.server,
                    keccak256(bytes(e.url)),
                    e.dna,
                    e.laidAt,
                    keccak256(bytes(e.surname)),
                    e.deadline
                )
            )
        );
    }

    /// @notice Take an egg: one per FID, as many FIDs as there are. Anyone may submit the attesters'
    /// signatures; the egg goes to `e.to`. Sent again for an egg that exists (same owner, DNA and
    /// cutoff), it moves the egg to another server.
    function takeEgg(Egg calldata e, bytes[] calldata signatures) external {
        if (block.timestamp > e.deadline) revert Expired();
        if (e.to == address(0) || e.server == address(0)) revert ZeroAddress();
        if (isAttester[e.server]) revert AlreadyAttester();
        uint256 other = eggOfServer[e.server];
        if (other != 0 && other != e.fid) revert ServerKeepsAnotherEgg();
        if (!_validSurname(e.surname)) revert BadSurname();
        _checkSignatures(eggDigest(e), signatures);

        Stage s = stageOf[e.fid];
        if (s == Stage.Fatliner) revert AlreadyHatched();
        if (s == Stage.Egg) {
            if (
                _ownerOf(e.fid) != e.to || dnaOf[e.fid] != e.dna || laidAtOf[e.fid] != e.laidAt
                    || keccak256(bytes(surnameOf[e.fid])) != keccak256(bytes(e.surname))
            ) revert NotTheSameEgg();
            delete eggOfServer[serverOf[e.fid]];
        } else {
            stageOf[e.fid] = Stage.Egg;
            eggCount++;
            dnaOf[e.fid] = e.dna;
            laidAtOf[e.fid] = e.laidAt;
            surnameOf[e.fid] = e.surname;
            _mint(e.to, e.fid);
            emit EggTaken(e.fid, e.to, e.server, e.dna, e.laidAt);
        }
        serverOf[e.fid] = e.server;
        serverUrlOf[e.fid] = e.url;
        eggOfServer[e.server] = e.fid;
        emit EggMoved(e.fid, e.server, e.url);
    }

    // ------------------------------------------------------------------ hatching

    function hatchDigest(Hatch calldata h) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(HATCH_TYPEHASH, h.fid, keccak256(bytes(h.surname)), h.deadline)));
    }

    /// @notice The egg becomes a Fatliner, with the surname its DNA gave it. Its server becomes an attester.
    function hatch(Hatch calldata h, bytes[] calldata signatures) external {
        if (block.timestamp > h.deadline) revert Expired();
        Stage s = stageOf[h.fid];
        if (s == Stage.Fatliner) revert AlreadyHatched();
        if (s != Stage.Egg) revert NoEgg();
        if (keccak256(bytes(h.surname)) != keccak256(bytes(surnameOf[h.fid]))) revert BadSurname(); // set at the egg
        _checkSignatures(hatchDigest(h), signatures);
        if (totalSupply >= maxSupply) revert SoldOut();
        _born(h.fid, _ownerOf(h.fid), h.surname, signatures.length);
    }

    function _born(uint256 fid, address to, string memory surname, uint256 signers) internal {
        stageOf[fid] = Stage.Fatliner;
        totalSupply++;
        surnameOf[fid] = surname;
        linkedFidOf[fid] = fid; // at birth, its holder is its origin
        address server = serverOf[fid];
        delete eggOfServer[server];
        isAttester[server] = true;
        urlOf[server] = serverUrlOf[fid];
        fidOfAttester[server] = fid;
        _attesters.push(server);
        emit AttesterJoined(server, fid, serverUrlOf[fid]);
        emit Born(fid, to, surname, dnaOf[fid], server, signers);
        emit FidLinked(fid, fid, to);
    }

    /// @dev 1 to 12 characters, A-Z and 0-9: what a coin's ticker can be.
    function _validSurname(string memory s) internal pure returns (bool) {
        bytes memory b = bytes(s);
        if (b.length == 0 || b.length > 12) return false;
        for (uint256 i; i < b.length; i++) {
            bytes1 c = b[i];
            if (!((c >= "A" && c <= "Z") || (c >= "0" && c <= "9"))) return false;
        }
        return true;
    }

    /// @notice Is `fid` an egg or a Fatliner? Either can have a coin.
    function hasCoinRight(uint256 fid) external view returns (bool) {
        return stageOf[fid] != Stage.None;
    }

    // ------------------------------------------------------------------ the launchpad's questions

    function _holderOf(uint256 fid) internal view override returns (address) {
        return _ownerOf(fid);
    }

    function _hasCoinRight(uint256 fid) internal view override returns (bool) {
        return stageOf[fid] != Stage.None;
    }

    function _tickerOf(uint256 fid) internal view override returns (string memory) {
        return surnameOf[fid];
    }

    function _genesis() internal view override returns (uint256) {
        return genesisFid;
    }

    /// @notice Is `fid` a hatched Fatliner?
    function isFatliner(uint256 fid) external view returns (bool) {
        return stageOf[fid] == Stage.Fatliner;
    }

    // ------------------------------------------------------------------ holding

    /// @notice The keeper link: the holder says which FID they live on Farcaster through.
    /// 0 removes the link. Readers check on a node that the holder's address belongs to `fid`.
    function linkFid(uint256 fatliner, uint256 fid) external {
        if (stageOf[fatliner] != Stage.Fatliner) revert NoEgg();
        if (ownerOf(fatliner) != msg.sender) revert NotHolder();
        linkedFidOf[fatliner] = fid;
        emit FidLinked(fatliner, fid, msg.sender);
    }

    /// @dev Eggs stay with the account that laid them. Fatliners move freely; a new holder brings their own
    /// frame of reference, so the keeper link is cleared on every transfer.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address from) {
        from = super._update(to, tokenId, auth);
        if (from != address(0) && stageOf[tokenId] == Stage.Egg) revert EggsDoNotMove();
        if (from != address(0) && from != to && linkedFidOf[tokenId] != 0) {
            delete linkedFidOf[tokenId];
            emit FidLinked(tokenId, 0, to);
        }
    }

    /// @notice Every resale pays the genesis Fatliner's vault.
    function royaltyInfo(uint256, uint256 salePrice) external view returns (address, uint256) {
        return (predictFatlinerVault(genesisFid), (salePrice * ROYALTY_BPS) / 10_000);
    }

    /// @notice One URI per token; the page shows an egg or a being by its stage.
    function tokenURI(uint256 fid) public view override returns (string memory) {
        _requireOwned(fid);
        return string.concat(baseUri, Strings.toString(fid));
    }

    function supportsInterface(bytes4 id) public view override(ERC721, IERC165) returns (bool) {
        return id == type(IERC2981).interfaceId || super.supportsInterface(id);
    }
}
