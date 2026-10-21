// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title Voices
/// @notice Long-form opinions that live outside any one social network.
///
/// Farcaster and Hypersnap casts stop at 320 bytes (1024 for long casts). A voice can be up to
/// 16 KiB. The text is emitted in an event, so it lives in the chain's history, not in contract
/// storage. Any indexer can rebuild the full feed from the logs alone.
///
/// A voice can name a Farcaster FID. That is a claim, not a proof. Indexers check it against the
/// network the reader chose (Farcaster or Hypersnap): the claim holds only if the author's address
/// is a verified address of that FID there.
///
/// Retracting hides a voice in honest clients. The original text stays in chain history.
contract Voices {
    uint256 public constant MAX_BYTES = 16_384;

    /// @notice Number of voices ever said. Ids start at 1; 0 means "no parent".
    uint256 public count;

    mapping(uint256 id => address author) public authorOf;
    mapping(uint256 id => bool) public retracted;

    event Voice(
        uint256 indexed id, address indexed author, uint256 indexed parentId, uint256 fid, string text
    );
    event Retracted(uint256 indexed id, address indexed author);

    error Empty();
    error TooLong(uint256 length);
    error UnknownParent(uint256 parentId);
    error NotAuthor();
    error AlreadyRetracted();

    /// @param text   The opinion. UTF-8, 1 to MAX_BYTES bytes.
    /// @param parentId 0 for a new voice, or the id of the voice this replies to.
    /// @param fid    The Farcaster FID the author claims, or 0 for none.
    function say(string calldata text, uint256 parentId, uint256 fid) external returns (uint256 id) {
        uint256 length = bytes(text).length;
        if (length == 0) revert Empty();
        if (length > MAX_BYTES) revert TooLong(length);
        if (parentId != 0 && authorOf[parentId] == address(0)) revert UnknownParent(parentId);

        id = ++count;
        authorOf[id] = msg.sender;
        emit Voice(id, msg.sender, parentId, fid, text);
    }

    function retract(uint256 id) external {
        if (authorOf[id] != msg.sender) revert NotAuthor();
        if (retracted[id]) revert AlreadyRetracted();
        retracted[id] = true;
        emit Retracted(id, msg.sender);
    }
}
