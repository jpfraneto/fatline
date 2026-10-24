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
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {AppVault} from "./AppVault.sol";
import {FatlineLaunchpad} from "./FatlineLaunchpad.sol";
import {SafeToken} from "./SafeToken.sol";

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
    using SafeToken for address;

    uint256 public constant ROYALTY_BPS = 800; // 8%
    uint256 public constant WARM_DAYS = 3; // what attesters wait for before they sign a Hatch
    uint256 public constant REQUIRED = 3; // signatures a set needs (or all attesters, while there are fewer)

    /// @dev The egg: who it belongs to, the server that keeps it warm (its hatchery key, which becomes an
    /// attester at hatching) and where that hatchery answers, the history commitment (DNA), its cutoff, and the
    /// surname read from that DNA: its coin's ticker from the day it is laid, and its name when it hatches. No two
    /// eggs share a surname (so no two coins share a ticker). And its stone, the material of its account's roots,
    /// read from the same history: 0 ivory, 1 marble, 2 sandstone, 3 basalt, 4 moss, 5 gold, 6 opal.
    bytes32 public constant EGG_TYPEHASH = keccak256(
        "Egg(uint256 fid,address to,address server,string url,bytes32 dna,uint64 laidAt,string surname,uint8 stone,uint256 deadline)"
    );
    /// @dev The hatching: which egg, and the surname read from its DNA (its coin's ticker).
    bytes32 public constant HATCH_TYPEHASH = keccak256("Hatch(uint256 fid,string surname,uint256 deadline)");
    /// @dev An egg whose node stopped: the attesters say so, and it dies.
    bytes32 public constant DEATH_TYPEHASH = keccak256("Death(uint256 fid,uint256 deadline)");
    /// @dev A token that changed hands wakes up living through its new holder's Farcaster account (sourceFid):
    /// a new history, so a new DNA and stone. Its surname, coin and vault stay.
    bytes32 public constant AWAKEN_TYPEHASH =
        keccak256("Awaken(uint256 fid,address holder,uint256 sourceFid,bytes32 dna,uint8 stone,uint256 deadline)");
    uint256 public constant HIBERNATION = 7 days; // after an egg dies, its account waits this long for another

    struct Death {
        uint256 fid;
        uint256 deadline;
    }

    struct Awaken {
        uint256 fid;
        address holder;
        uint256 sourceFid;
        bytes32 dna;
        uint8 stone;
        uint256 deadline;
    }

    struct Egg {
        uint256 fid;
        address to;
        address server;
        string url;
        bytes32 dna;
        uint64 laidAt;
        string surname;
        uint8 stone;
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
    uint256 public liveEggs; // eggs now (not hatched, not dead); liveEggs + totalSupply <= maxSupply
    mapping(uint256 fid => uint256) public priceOf; // USDC (6 decimals) its holder asks; 0 = not for sale
    bool private _selling; // the only way a token changes hands is a sale, paid in USDC
    mapping(uint256 fid => uint256) public hibernatingUntil; // after its egg died, no new egg before this
    bytes32 public orderRoot; // the ranking: leaves keccak256(abi.encode(fid, position)); 0 = open to everyone
    uint64 public orderStart; // day 1 of the ranking's window
    address public immutable orderAdmin; // who publishes the ranking's root (the deployer)
    mapping(uint256 fid => Stage) public stageOf;
    mapping(uint256 fid => bytes32) public dnaOf; // the history it hatches from
    mapping(uint256 fid => uint64) public laidAtOf; // that history's cutoff
    mapping(uint256 fid => address) public serverOf; // the server keeping (or that kept) the egg warm
    mapping(uint256 fid => string) public serverUrlOf;
    mapping(address server => uint256 fid) public eggOfServer; // one server, one egg
    mapping(uint256 fid => string) public surnameOf; // set when the egg is taken; its coin's ticker
    mapping(bytes32 surnameHash => uint256 fid) public fidOfSurname; // one egg per surname, one coin per ticker
    mapping(uint256 fid => uint8) public stoneOf; // the egg's stone (see Egg)
    /// @dev One node, one client, one contract: the smart contract that shapes how this Fatline's client works.
    /// Its holder sets it (and can replace it), but there is only ever one. 0 = none yet.
    mapping(uint256 fid => address) public appOf;
    mapping(uint256 fid => uint256) public linkedFidOf; // the keeper link

    event AttesterJoined(address indexed attester, uint256 indexed fid, string url);
    event UrlChanged(address indexed attester, string url);
    event EggTaken(uint256 indexed fid, address indexed to, address indexed server, bytes32 dna, uint64 laidAt);
    event EggMoved(uint256 indexed fid, address indexed server, string url);
    event Stone(uint256 indexed fid, uint8 stone);
    event AppSet(uint256 indexed fid, address indexed app);
    event Born(uint256 indexed fid, address indexed to, string surname, bytes32 dna, address server, uint256 signers);
    event FidLinked(uint256 indexed fatliner, uint256 indexed fid, address indexed holder);
    event Died(uint256 indexed fid, uint256 hibernatingUntil);
    event Listed(uint256 indexed fid, address indexed holder, uint256 price);
    event Sold(uint256 indexed fid, address indexed from, address indexed to, uint256 price);
    event Order(bytes32 root, uint64 start);

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
    error Hibernating();
    error OnlyBySale();
    error NotForSale();
    error PriceChanged();
    error NotYourTurn();
    error NoSlot();
    error Asleep();
    error NotOrderAdmin();
    error StillAnEgg();
    error BadSurname();
    error SurnameTaken();
    error BadStone();
    error NotAContract();
    error SoldOut();
    error ZeroAddress();

    /// @dev The genesis Fatliner, born with this contract.
    struct Genesis {
        address server; // the genesis server's hatchery key: the first attester
        string url; // where its hatchery answers
        uint256 fid; // the genesis Fatliner (Aster: 18350)
        address to; // who it is born to
        string surname; // its surname and its coin's ticker (Aster's: FATLINE)
        bytes32 dna; // its history commitment, up to laidAt
        uint64 laidAt;
        uint8 stone; // its stone, read from that history (Aster's: 5, gold)
        address app; // the smart contract its client runs on (Aster's: Voices), or 0
    }

    constructor(
        uint256 maxSupply_,
        Genesis memory g,
        string memory baseUri_,
        Clanker memory clanker_,
        AppVault.Tier[] memory tiers_
    ) ERC721("Fatliners", "FATLINER") EIP712("Fatliners", "1") FatlineLaunchpad(clanker_, tiers_) {
        if (g.server == address(0) || g.to == address(0)) revert ZeroAddress();
        if (!_validSurname(g.surname)) revert BadSurname();
        if (g.stone > 6) revert BadStone();
        maxSupply = maxSupply_;
        baseUri = baseUri_;
        genesisFid = g.fid;
        orderAdmin = msg.sender;
        eggCount = 1;
        liveEggs = 1;
        stageOf[g.fid] = Stage.Egg; // Aster starts as an egg too: it hatches after three warm days, like any other
        surnameOf[g.fid] = g.surname;
        linkedFidOf[g.fid] = g.fid;
        dnaOf[g.fid] = g.dna;
        laidAtOf[g.fid] = g.laidAt;
        serverOf[g.fid] = g.server;
        serverUrlOf[g.fid] = g.url;
        eggOfServer[g.server] = g.fid;
        fidOfSurname[keccak256(bytes(g.surname))] = g.fid; // FATLINE is Aster's
        stoneOf[g.fid] = g.stone;
        emit Stone(g.fid, g.stone);
        if (g.app != address(0)) {
            appOf[g.fid] = g.app;
            emit AppSet(g.fid, g.app);
        }
        // Its server is the first attester from the start, so there is someone to sign Aster's own hatching.
        isAttester[g.server] = true;
        urlOf[g.server] = g.url;
        fidOfAttester[g.server] = g.fid;
        _attesters.push(g.server);
        emit AttesterJoined(g.server, g.fid, g.url);
        _mint(g.to, g.fid);
        emit EggTaken(g.fid, g.to, g.server, g.dna, g.laidAt);
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
                    e.stone,
                    e.deadline
                )
            )
        );
    }

    /// @notice Take an egg: one per FID, as many FIDs as there are. Anyone may submit the attesters'
    /// signatures; the egg goes to `e.to`. Sent again for an egg that exists (same owner, DNA and
    /// cutoff), it moves the egg to another server.
    /// While the ranking is published (`orderRoot`), a new egg needs its FID's place in it: `position` and a Merkle
    /// `proof`, and that place must be open today (day 1: 1–777, day 2: 1–7,777, day 3: 1–77,777, then everyone).
    function takeEgg(Egg calldata e, bytes[] calldata signatures, uint256 position, bytes32[] calldata proof) external {
        if (block.timestamp > e.deadline) revert Expired();
        if (e.to == address(0) || e.server == address(0)) revert ZeroAddress();
        if (isAttester[e.server]) revert AlreadyAttester();
        uint256 other = eggOfServer[e.server];
        if (other != 0 && other != e.fid) revert ServerKeepsAnotherEgg();
        if (!_validSurname(e.surname)) revert BadSurname();
        if (e.stone > 6) revert BadStone();
        _checkSignatures(eggDigest(e), signatures);

        Stage s = stageOf[e.fid];
        if (s == Stage.Fatliner) revert AlreadyHatched();
        if (s == Stage.Egg) {
            if (
                _ownerOf(e.fid) != e.to || dnaOf[e.fid] != e.dna || laidAtOf[e.fid] != e.laidAt
                    || keccak256(bytes(surnameOf[e.fid])) != keccak256(bytes(e.surname)) || stoneOf[e.fid] != e.stone
            ) revert NotTheSameEgg();
            delete eggOfServer[serverOf[e.fid]];
        } else {
            if (block.timestamp < hibernatingUntil[e.fid]) revert Hibernating();
            if (!mayTakeEgg(e.fid, position, proof)) revert NotYourTurn();
            if (liveEggs + totalSupply >= maxSupply) revert NoSlot();
            stageOf[e.fid] = Stage.Egg;
            eggCount++;
            liveEggs++;
            linkedFidOf[e.fid] = e.fid;
            dnaOf[e.fid] = e.dna;
            laidAtOf[e.fid] = e.laidAt;
            bytes32 h = keccak256(bytes(e.surname));
            uint256 holder = fidOfSurname[h];
            if (holder != 0 && holder != e.fid) revert SurnameTaken();
            fidOfSurname[h] = e.fid;
            surnameOf[e.fid] = e.surname;
            stoneOf[e.fid] = e.stone;
            emit Stone(e.fid, e.stone);
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
        if (linkedFidOf[h.fid] == 0) revert Asleep(); // moved and not woken by its new holder yet
        _checkSignatures(hatchDigest(h), signatures);
        if (totalSupply >= maxSupply) revert SoldOut();
        liveEggs--;
        _born(h.fid, _ownerOf(h.fid), h.surname, signatures.length);
    }

    function _born(uint256 fid, address to, string memory surname, uint256 signers) internal {
        stageOf[fid] = Stage.Fatliner;
        totalSupply++;
        surnameOf[fid] = surname;
        address server = serverOf[fid];
        delete eggOfServer[server];
        if (!isAttester[server]) { // the genesis server already is one
            isAttester[server] = true;
            urlOf[server] = serverUrlOf[fid];
            fidOfAttester[server] = fid;
            _attesters.push(server);
            emit AttesterJoined(server, fid, serverUrlOf[fid]);
        }
        emit Born(fid, to, surname, dnaOf[fid], server, signers);
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

    // ------------------------------------------------------------------ death, sleep and the order

    /// @notice An egg whose node stopped dies, when the attesters say so: it is burned, its slot opens for the next
    /// person, and its account hibernates for seven days before it can take another egg. Its coin, if any, stays.
    function die(Death calldata d, bytes[] calldata signatures) external {
        if (block.timestamp > d.deadline) revert Expired();
        if (stageOf[d.fid] != Stage.Egg) revert NoEgg();
        if (d.fid == genesisFid) revert StillAnEgg(); // Aster is kept by the genesis server itself
        _checkSignatures(_hashTypedDataV4(keccak256(abi.encode(DEATH_TYPEHASH, d.fid, d.deadline))), signatures);
        stageOf[d.fid] = Stage.None;
        liveEggs--;
        delete eggOfServer[serverOf[d.fid]];
        delete linkedFidOf[d.fid];
        hibernatingUntil[d.fid] = block.timestamp + HIBERNATION;
        _burn(d.fid);
        emit Died(d.fid, hibernatingUntil[d.fid]);
    }

    /// @notice A token that changed hands is asleep (`linkedFidOf` = 0) until its new holder wakes it: they choose the
    /// Farcaster account it lives through, and the attesters sign the DNA and stone read from that account's history.
    function awaken(Awaken calldata a, bytes[] calldata signatures) external {
        if (block.timestamp > a.deadline) revert Expired();
        if (stageOf[a.fid] == Stage.None) revert NoEgg();
        if (_ownerOf(a.fid) != a.holder) revert NotHolder();
        if (a.stone > 6) revert BadStone();
        _checkSignatures(
            _hashTypedDataV4(
                keccak256(abi.encode(AWAKEN_TYPEHASH, a.fid, a.holder, a.sourceFid, a.dna, a.stone, a.deadline))
            ),
            signatures
        );
        linkedFidOf[a.fid] = a.sourceFid;
        dnaOf[a.fid] = a.dna;
        stoneOf[a.fid] = a.stone;
        emit Stone(a.fid, a.stone);
        emit FidLinked(a.fid, a.sourceFid, a.holder);
    }

    function isAsleep(uint256 fid) external view returns (bool) {
        return stageOf[fid] != Stage.None && linkedFidOf[fid] == 0;
    }

    /// @notice Publishes the ranking (its Merkle root) and when its window opens. 0 opens eggs to everyone.
    function setOrder(bytes32 root, uint64 start) external {
        if (msg.sender != orderAdmin) revert NotOrderAdmin();
        orderRoot = root;
        orderStart = start;
        emit Order(root, start);
    }

    /// @notice Can `fid`, at `position` in the ranking, take an egg today?
    function mayTakeEgg(uint256 fid, uint256 position, bytes32[] calldata proof) public view returns (bool) {
        if (orderRoot == bytes32(0)) return true;
        if (block.timestamp < orderStart) return false;
        if (!MerkleProof.verifyCalldata(proof, orderRoot, keccak256(bytes.concat(keccak256(abi.encode(fid, position)))))) {
            return false;
        }
        uint256 day = (block.timestamp - orderStart) / 1 days;
        return day >= 3 || position <= [uint256(777), 7_777, 77_777][day];
    }

    /// @notice The holder of an egg or a Fatliner ties one smart contract to it: the one its client runs on.
    /// Setting another replaces it; address(0) unties it.
    function setApp(uint256 fid, address app) external {
        if (stageOf[fid] == Stage.None) revert NoEgg();
        if (_ownerOf(fid) != msg.sender) revert NotHolder();
        if (app != address(0) && app.code.length == 0) revert NotAContract();
        appOf[fid] = app;
        emit AppSet(fid, app);
    }

    // ------------------------------------------------------------------ the market: the only way to move

    /// @notice The holder puts an egg or a Fatliner up for sale, in USDC (6 decimals). 0 takes it off.
    function list(uint256 fid, uint256 price) external {
        if (_ownerOf(fid) != msg.sender) revert NotHolder();
        priceOf[fid] = price;
        emit Listed(fid, msg.sender, price);
    }

    /// @notice Buy it at its price (`maxPrice` guards against a change while you sign). The seller gets the price
    /// minus 8%, which goes to the genesis Fatliner's vault. Then it is yours, and asleep until you wake it.
    function buy(uint256 fid, uint256 maxPrice) external {
        uint256 price = priceOf[fid];
        if (price == 0) revert NotForSale();
        if (price > maxPrice) revert PriceChanged();
        address seller = _ownerOf(fid);
        uint256 royalty = (price * ROYALTY_BPS) / 10_000;
        usdc.safeTransferFrom(msg.sender, seller, price - royalty);
        if (royalty != 0) usdc.safeTransferFrom(msg.sender, predictFatlinerVault(genesisFid), royalty);
        _selling = true;
        _transfer(seller, msg.sender, fid);
        _selling = false;
        emit Sold(fid, seller, msg.sender, price);
    }

    /// @dev Tokens are minted (an egg) and burned (an egg that died), and otherwise move only by `buy`. A new holder
    /// brings their own frame of reference: the token falls asleep (its link to a Farcaster account is cleared)
    /// until they wake it (`awaken`). Any listing ends with the sale.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address from) {
        from = super._update(to, tokenId, auth);
        if (from != address(0) && to != address(0) && !_selling) revert OnlyBySale();
        if (priceOf[tokenId] != 0) delete priceOf[tokenId];
        if (from != address(0) && to != address(0) && from != to && linkedFidOf[tokenId] != 0) {
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
