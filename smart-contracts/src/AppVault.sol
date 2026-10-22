// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SafeToken} from "./SafeToken.sol";
import {IClankerFeeLocker, IClankerLpLocker} from "./interfaces/IClanker.sol";

/// @title AppVault
/// @notice The USDC pile that keeps one Fatline app alive.
///
/// Money comes in from three places: the trading fees of the app's coin (already converted to
/// USDC by Clanker), anyone who deposits, and the owner. Money goes out in two ways: the app's
/// server (the keeper) pays itself for compute one billing period at a time, and the owner moves
/// what they want. When there is no USDC left for the next period, the server cannot pay itself
/// and the app dies. Depositing again brings it back.
///
/// Compute comes in tiers. Higher tiers cost more per second and are unlocked by daily active
/// users, counted by this contract itself: every person who uses the app checks in once a day,
/// either with their own transaction or with a free signature that anyone (usually the app's
/// server) submits in a batch. The contract verifies each signature and counts unique people.
contract AppVault {
    using SafeToken for address;

    struct Tier {
        uint64 ratePerSecond; // USDC units (6 decimals) per second of compute
        uint32 minDau; // daily active users needed to choose this tier
    }

    uint256 public constant MIN_PERIOD = 1 days;
    uint256 public constant MAX_PERIOD = 31 days;

    address public immutable factory;
    address public usdc;
    IClankerLpLocker public locker;
    IClankerFeeLocker public feeLocker;

    address public owner;
    address public pendingOwner;
    address public keeper; // the server's own wallet: it pays the compute provider
    address public coin; // the app's coin, or 0 if the app has none

    Tier[] internal _tiers;
    uint8 public tier;
    uint256 public billingPeriod; // how far ahead the keeper may pay itself (1 to 31 days)
    uint256 public paidThrough; // compute is paid up to this timestamp

    // Presence: unique people per day (day = unix time / 1 day).
    bytes32 public constant CHECKIN_TYPEHASH = keccak256("CheckIn(uint256 day)");
    mapping(uint256 day => uint32) public dauOf;
    mapping(uint256 day => mapping(address => bool)) public checkedIn;
    uint256 public minCoinToCount; // optional: only people holding this much of the app's coin count
    string public uri; // the app: JSON with name, experience (app/video/image/link), etc.

    event Deposited(address indexed from, uint256 amount, string note);
    event Harvested(uint256 amount);
    event ComputePaid(address indexed keeper, uint256 amount, uint256 paidThrough);
    event Withdrawn(address indexed to, uint256 amount);
    event TierChanged(uint8 tier, uint256 ratePerSecond);
    event CheckedIn(address indexed person, uint256 indexed day);
    event KeeperChanged(address keeper);
    event MinCoinToCountChanged(uint256 amount);
    event BillingPeriodChanged(uint256 period);
    event UriChanged(string uri);
    event OwnershipTransferStarted(address indexed from, address indexed to);
    event OwnershipTransferred(address indexed from, address indexed to);

    error NotFactory();
    error NotOwner();
    error NotKeeper();
    error NotCounted();
    error AlreadyInitialized();
    error UnknownTier();
    error NotEnoughDau(uint32 have, uint32 need);
    error BadPeriod();
    error NothingToPay();
    error InsufficientFree();
    error ZeroAddress();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor() {
        factory = msg.sender;
    }

    function initialize(
        address usdc_,
        IClankerLpLocker locker_,
        IClankerFeeLocker feeLocker_,
        address owner_,
        address keeper_,
        Tier[] calldata tiers_,
        uint256 billingPeriod_,
        string calldata uri_
    ) external {
        if (msg.sender != factory) revert NotFactory();
        if (owner != address(0)) revert AlreadyInitialized();
        if (owner_ == address(0) || keeper_ == address(0)) revert ZeroAddress();
        if (billingPeriod_ < MIN_PERIOD || billingPeriod_ > MAX_PERIOD) revert BadPeriod();
        usdc = usdc_;
        locker = locker_;
        feeLocker = feeLocker_;
        owner = owner_;
        keeper = keeper_;
        for (uint256 i; i < tiers_.length; i++) {
            _tiers.push(tiers_[i]);
        }
        billingPeriod = billingPeriod_;
        paidThrough = block.timestamp;
        uri = uri_;
        emit OwnershipTransferred(address(0), owner_);
        emit KeeperChanged(keeper_);
        emit TierChanged(0, tiers_[0].ratePerSecond);
    }

    /// @notice Set once by the factory when the app launches with a coin.
    function setCoin(address coin_) external {
        if (msg.sender != factory) revert NotFactory();
        if (coin != address(0)) revert AlreadyInitialized();
        coin = coin_;
    }

    // ------------------------------------------------------------------ views

    function tiers() external view returns (Tier[] memory) {
        return _tiers;
    }

    function ratePerSecond() public view returns (uint256) {
        return _tiers[tier].ratePerSecond;
    }

    function balance() public view returns (uint256) {
        (bool ok, bytes memory ret) = usdc.staticcall(abi.encodeWithSignature("balanceOf(address)", address(this)));
        return ok && ret.length >= 32 ? abi.decode(ret, (uint256)) : 0;
    }

    /// @notice Fees earned by the coin and waiting in Clanker's fee locker.
    function pendingFees() public view returns (uint256) {
        if (coin == address(0)) return 0;
        return feeLocker.availableFees(address(this), usdc);
    }

    /// @notice If nobody adds money from now on, the app runs until this moment.
    function aliveUntil() public view returns (uint256) {
        uint256 from = paidThrough > block.timestamp ? paidThrough : block.timestamp;
        return from + (balance() + pendingFees()) / ratePerSecond();
    }

    function isAlive() external view returns (bool) {
        return paidThrough > block.timestamp;
    }

    /// @notice What the keeper would be paid by `payCompute` right now.
    function computeDue() public view returns (uint256 amount, uint256 newPaidThrough) {
        uint256 rate = ratePerSecond();
        uint256 start = paidThrough > block.timestamp ? paidThrough : block.timestamp;
        uint256 target = block.timestamp + billingPeriod;
        if (target <= start) return (0, paidThrough);
        uint256 seconds_ = target - start;
        uint256 available = balance() + pendingFees();
        if (seconds_ * rate > available) seconds_ = available / rate;
        return (seconds_ * rate, start + seconds_);
    }

    // ------------------------------------------------------------------ money in

    function deposit(uint256 amount, string calldata note) external {
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount, note);
    }

    /// @notice Pull the coin's trading fees (as USDC) into the vault. Anyone can call it.
    function harvest() public returns (uint256 amount) {
        if (coin == address(0)) return 0;
        // Move fees sitting in the pool into the fee locker; ignore failures (e.g. nothing to collect).
        try locker.collectRewards(coin) {} catch {}
        amount = feeLocker.availableFees(address(this), usdc);
        if (amount == 0) return 0;
        feeLocker.claim(address(this), usdc);
        emit Harvested(amount);
    }

    // ------------------------------------------------------------------ money out

    /// @notice The server pays itself for compute up to one billing period ahead.
    /// If the app was dead, time restarts now: nobody pays for the time it was dead.
    function payCompute() external returns (uint256 amount) {
        if (msg.sender != keeper) revert NotKeeper();
        harvest();
        uint256 newPaidThrough;
        (amount, newPaidThrough) = computeDue();
        if (amount == 0) revert NothingToPay();
        paidThrough = newPaidThrough;
        usdc.safeTransfer(keeper, amount);
        emit ComputePaid(keeper, amount, newPaidThrough);
    }

    /// @notice The owner moves USDC (to buy other coins, pay people, anything). Less money is less life.
    function withdraw(address to, uint256 amount) external onlyOwner {
        if (amount > balance()) revert InsufficientFree();
        usdc.safeTransfer(to, amount);
        emit Withdrawn(to, amount);
    }

    // ------------------------------------------------------------------ power

    function today() public view returns (uint256) {
        return block.timestamp / 1 days;
    }

    /// @notice Daily active users of the last complete day. This is what unlocks tiers.
    function dau() public view returns (uint32) {
        uint256 t = today();
        return t == 0 ? 0 : dauOf[t - 1];
    }

    /// @notice EIP-712 domain: each app's check-ins are only valid for that app.
    function domainSeparator() public view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("Fatline App"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
    }

    function checkInDigest(uint256 day) public view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), keccak256(abi.encode(CHECKIN_TYPEHASH, day))));
    }

    /// @notice I was here today. Costs the person a transaction; the free way is a signature.
    function checkIn() external {
        if (!_count(msg.sender, today())) revert NotCounted();
    }

    /// @notice Submit people's signed check-ins in one batch. Anyone can call it (usually the app's
    /// server). Signatures for today or yesterday are accepted, so a batch posted just after
    /// midnight still counts. Invalid, repeated or non-holding entries are skipped, not reverted.
    function checkInFor(address[] calldata people, uint256[] calldata days_, bytes[] calldata signatures)
        external
        returns (uint256 counted)
    {
        uint256 t = today();
        for (uint256 i; i < people.length; i++) {
            uint256 day = days_[i];
            if (day != t && day + 1 != t) continue;
            if (!_validSignature(people[i], checkInDigest(day), signatures[i])) continue;
            if (_count(people[i], day)) counted++;
        }
    }

    function _count(address person, uint256 day) internal returns (bool) {
        if (checkedIn[day][person]) return false;
        if (minCoinToCount > 0 && (coin == address(0) || _balanceOf(coin, person) < minCoinToCount)) return false;
        checkedIn[day][person] = true;
        dauOf[day]++;
        emit CheckedIn(person, day);
        return true;
    }

    /// @dev Plain wallets (ECDSA) and smart wallets (ERC-1271, including EIP-7702 accounts).
    function _validSignature(address signer, bytes32 digest, bytes calldata sig) internal view returns (bool) {
        if (sig.length == 65) {
            bytes32 r = bytes32(sig[0:32]);
            bytes32 s_ = bytes32(sig[32:64]);
            uint8 v = uint8(sig[64]);
            address recovered = ecrecover(digest, v, r, s_);
            if (recovered != address(0) && recovered == signer) return true;
        }
        if (signer.code.length == 0) return false;
        (bool ok, bytes memory ret) = signer.staticcall(abi.encodeWithSelector(0x1626ba7e, digest, sig));
        return ok && ret.length >= 32 && abi.decode(ret, (bytes4)) == 0x1626ba7e;
    }

    function _balanceOf(address token, address who) internal view returns (uint256) {
        (bool ok, bytes memory ret) = token.staticcall(abi.encodeWithSignature("balanceOf(address)", who));
        return ok && ret.length >= 32 ? abi.decode(ret, (uint256)) : 0;
    }

    /// @notice Choose how much compute the app gets. Lower tiers are always allowed.
    function setTier(uint8 tier_) external onlyOwner {
        if (tier_ >= _tiers.length) revert UnknownTier();
        uint32 need = _tiers[tier_].minDau;
        uint32 have = dau();
        if (tier_ > tier && have < need) revert NotEnoughDau(have, need);
        tier = tier_;
        emit TierChanged(tier_, _tiers[tier_].ratePerSecond);
    }

    // ------------------------------------------------------------------ settings

    function setKeeper(address keeper_) external onlyOwner {
        if (keeper_ == address(0)) revert ZeroAddress();
        keeper = keeper_;
        emit KeeperChanged(keeper_);
    }

    /// @notice Only count people who hold at least this much of the app's coin (0 = everyone).
    function setMinCoinToCount(uint256 amount) external onlyOwner {
        minCoinToCount = amount;
        emit MinCoinToCountChanged(amount);
    }

    function setBillingPeriod(uint256 period) external onlyOwner {
        if (period < MIN_PERIOD || period > MAX_PERIOD) revert BadPeriod();
        billingPeriod = period;
        emit BillingPeriodChanged(period);
    }

    function setUri(string calldata uri_) external onlyOwner {
        uri = uri_;
        emit UriChanged(uri_);
    }

    /// @notice Two steps, so ownership never goes to an address that cannot act (e.g. a typo).
    function transferOwnership(address to) external onlyOwner {
        pendingOwner = to;
        emit OwnershipTransferStarted(owner, to);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotOwner();
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }
}
