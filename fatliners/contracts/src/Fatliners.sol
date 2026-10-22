// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title Fatliners: 777 beings, one per FID, each born from that FID's history.
/// @notice NOT DEPLOYED. Architecture prototype with tests. No payments, no token economy.
///
/// Three identities are kept apart on purpose:
///   - the FID whose history generated the being (origin.fid), fixed forever
///   - the wallet that was authorized to mint it (origin.minter), fixed forever
///   - the wallet that owns it now (ownerOf), which changes with every transfer
/// A transfer never rewrites the origin. A FID can be born only once, even after its being is sold.
///
/// Eligibility is attested offchain: an attester key signs (fid, minter, snapshot, commitment, renderer)
/// after checking the minter is the FID's custody address or one of its verified addresses, on the
/// network the snapshot names. The commitment is fatliners/src/history.mjs commitment(): a hash over the
/// exact message set per network, so anyone holding those messages can check the being's origin.
contract Fatliners {
    // ------------------------------------------------------------------ ERC-721 storage
    string public constant name = "Fatliners";
    string public constant symbol = "FATLINER";
    uint256 public constant MAX_SUPPLY = 777;

    mapping(uint256 => address) private _owner;
    mapping(address => uint256) private _balance;
    mapping(uint256 => address) public getApproved;
    mapping(address => mapping(address => bool)) public isApprovedForAll;

    // ------------------------------------------------------------------ Fatliner storage
    struct Origin {
        uint64 fid;          // whose history
        uint64 snapshotAt;   // ms, the moment the history was frozen
        uint64 mintedAt;     // block timestamp
        address minter;      // the wallet that was authorized
        bytes32 commitment;  // history commitment (see above)
        bytes32 renderer;    // keccak256 of the renderer/DNA version string, e.g. "fatliners.render/1|fatliners.dna/1"
    }

    mapping(uint256 => Origin) private _origin; // tokenId → origin, written once
    mapping(uint256 => uint256) public tokenOfFid; // fid → tokenId (0 = never born)
    uint256 public totalSupply;

    address public admin;       // can rotate the attester and set metadata until frozen; can renounce
    address public attester;
    string private _baseURI;
    bool public metadataFrozen;

    bytes32 private constant MINT_TYPEHASH = keccak256(
        "Mint(uint64 fid,address minter,uint64 snapshotAt,bytes32 commitment,bytes32 renderer,uint256 deadline)"
    );
    bytes32 public immutable DOMAIN_SEPARATOR;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    event Born(uint256 indexed tokenId, uint64 indexed fid, address indexed minter, bytes32 commitment, bytes32 renderer);
    event AttesterChanged(address attester);
    event AdminChanged(address admin);
    event MetadataFrozen(string baseURI);

    error NotAdmin();
    error SoldOut();
    error AlreadyBorn(uint64 fid, uint256 tokenId);
    error Expired();
    error BadSignature();
    error NotAuthorized();
    error NoSuchToken();
    error Frozen();
    error UnsafeRecipient();
    error ZeroAddress();

    constructor(address admin_, address attester_) {
        if (admin_ == address(0) || attester_ == address(0)) revert ZeroAddress();
        admin = admin_;
        attester = attester_;
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(name)),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    // ------------------------------------------------------------------ birth

    /// @notice Mint the being of `fid` to the caller. Free: the contract never takes money.
    function mint(
        uint64 fid,
        uint64 snapshotAt,
        bytes32 commitment,
        bytes32 renderer,
        uint256 deadline,
        bytes calldata signature
    ) external returns (uint256 tokenId) {
        if (block.timestamp > deadline) revert Expired();
        if (tokenOfFid[fid] != 0) revert AlreadyBorn(fid, tokenOfFid[fid]);
        if (totalSupply >= MAX_SUPPLY) revert SoldOut();
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                DOMAIN_SEPARATOR,
                keccak256(abi.encode(MINT_TYPEHASH, fid, msg.sender, snapshotAt, commitment, renderer, deadline))
            )
        );
        if (_recover(digest, signature) != attester) revert BadSignature();

        tokenId = ++totalSupply;
        tokenOfFid[fid] = tokenId;
        _origin[tokenId] = Origin(fid, snapshotAt, uint64(block.timestamp), msg.sender, commitment, renderer);
        _owner[tokenId] = msg.sender;
        unchecked { _balance[msg.sender]++; }
        emit Transfer(address(0), msg.sender, tokenId);
        emit Born(tokenId, fid, msg.sender, commitment, renderer);
    }

    function origin(uint256 tokenId) external view returns (Origin memory) {
        if (_owner[tokenId] == address(0)) revert NoSuchToken();
        return _origin[tokenId];
    }

    // ------------------------------------------------------------------ admin (small, and can go away)

    function setAttester(address a) external {
        if (msg.sender != admin) revert NotAdmin();
        if (a == address(0)) revert ZeroAddress();
        attester = a;
        emit AttesterChanged(a);
    }

    function setAdmin(address a) external { // address(0) renounces
        if (msg.sender != admin) revert NotAdmin();
        admin = a;
        emit AdminChanged(a);
    }

    function setBaseURI(string calldata uri) external {
        if (msg.sender != admin) revert NotAdmin();
        if (metadataFrozen) revert Frozen();
        _baseURI = uri;
    }

    function freezeMetadata() external {
        if (msg.sender != admin) revert NotAdmin();
        metadataFrozen = true;
        emit MetadataFrozen(_baseURI);
    }

    // ------------------------------------------------------------------ ERC-721

    function ownerOf(uint256 tokenId) public view returns (address o) {
        o = _owner[tokenId];
        if (o == address(0)) revert NoSuchToken();
    }

    function balanceOf(address o) external view returns (uint256) {
        if (o == address(0)) revert ZeroAddress();
        return _balance[o];
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        ownerOf(tokenId);
        return string.concat(_baseURI, _toString(tokenId));
    }

    function approve(address spender, uint256 tokenId) external {
        address o = ownerOf(tokenId);
        if (msg.sender != o && !isApprovedForAll[o][msg.sender]) revert NotAuthorized();
        getApproved[tokenId] = spender;
        emit Approval(o, spender, tokenId);
    }

    function setApprovalForAll(address operator, bool approved) external {
        isApprovedForAll[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        if (from != ownerOf(tokenId)) revert NotAuthorized();
        if (to == address(0)) revert ZeroAddress();
        if (msg.sender != from && !isApprovedForAll[from][msg.sender] && msg.sender != getApproved[tokenId]) {
            revert NotAuthorized();
        }
        unchecked {
            _balance[from]--;
            _balance[to]++;
        }
        _owner[tokenId] = to;
        delete getApproved[tokenId];
        emit Transfer(from, to, tokenId); // the origin is untouched
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        safeTransferFrom(from, to, tokenId, "");
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes memory data) public {
        transferFrom(from, to, tokenId);
        if (to.code.length != 0) {
            try IERC721Receiver(to).onERC721Received(msg.sender, from, tokenId, data) returns (bytes4 r) {
                if (r != IERC721Receiver.onERC721Received.selector) revert UnsafeRecipient();
            } catch {
                revert UnsafeRecipient();
            }
        }
    }

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == 0x01ffc9a7 || id == 0x80ac58cd || id == 0x5b5e139f; // ERC165, ERC721, ERC721Metadata
    }

    // ------------------------------------------------------------------ helpers

    function _recover(bytes32 digest, bytes calldata sig) private pure returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 r = bytes32(sig[0:32]);
        bytes32 s = bytes32(sig[32:64]);
        uint8 v = uint8(sig[64]);
        // reject malleable signatures (upper-half s)
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) return address(0);
        return ecrecover(digest, v, r, s);
    }

    function _toString(uint256 v) private pure returns (string memory) {
        if (v == 0) return "0";
        uint256 len;
        for (uint256 t = v; t != 0; t /= 10) len++;
        bytes memory b = new bytes(len);
        for (; v != 0; v /= 10) b[--len] = bytes1(uint8(48 + (v % 10)));
        return string(b);
    }
}

interface IERC721Receiver {
    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data)
        external
        returns (bytes4);
}
