// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AppVault} from "./AppVault.sol";
import {SafeToken} from "./SafeToken.sol";
import {IClanker, IClankerFeeLocker, IClankerLpLocker, TokenRewardInfo} from "./interfaces/IClanker.sol";

/// @title AppFactory (the Fatline launchpad)
/// @notice One coin per Fatliner, and only Fatliners: at most 777 coins, ever. Each Fatliner gets one vault,
/// at an address known before it exists (`predictFatlinerVault`), owned by whoever holds that Fatliner,
/// and one coin on Clanker, paired with USDC, launched by its holder.
///
/// The coin's ticker is the Fatliner's surname, read from its DNA when it hatched (`Fatliners.surnameOf`):
/// nobody picks it, not even the holder. The first coin is the genesis Fatliner's ($FATLINE); no other
/// can launch before it.
///
/// The factory checks the launched coin onchain and reverts unless 100% of its trading fees go to the
/// Fatliner's vault, converted to USDC, with the vault as the only admin. Since the vault has no function
/// to change that, nobody (not the holder, not us) can ever redirect the fees.
///
/// Apps without a coin can still have a vault (`createApp`): they live on deposits.
contract AppFactory {
    using SafeToken for address;

    uint8 internal constant FEE_IN_PAIRED = 1;

    address public immutable usdc;
    address public immutable clanker;
    IClankerLpLocker public immutable locker;
    IClankerFeeLocker public immutable feeLocker;

    AppVault.Tier[] internal _tiers;

    address public immutable deployer; // may set the Fatliners contract, once
    address public fatliners;
    mapping(uint256 fid => address vault) public vaultOfFatliner;
    uint256 public coinsLaunched; // at most one per Fatliner
    mapping(uint256 fid => address coin) public coinOfFatliner;

    address[] public apps;
    mapping(address coin => address vault) public vaultOfCoin;
    mapping(address vault => bool) public isApp;

    struct AppParams {
        address owner; // a person or a multisig (e.g. a Safe)
        address keeper; // the server wallet that pays for compute
        uint256 billingPeriod; // seconds the keeper may pay ahead (1 to 31 days)
        string uri; // the app's description and experience
        bytes32 salt;
    }

    event AppCreated(address indexed vault, address indexed creator, address indexed owner, string uri);
    event CoinLaunched(address indexed vault, address indexed coin);
    event FatlinersSet(address fatliners);
    event FatlineBorn(uint256 indexed fid, address indexed vault);

    error EmptyTiers();
    error FirstTierMustBeOpen();
    error NotDeployToken();
    error ClankerFailed(bytes reason);
    error FeesNotLockedToVault();
    error NotPairedWithUsdc();
    error NotDeployer();
    error AlreadySet();
    error NoFatliners();
    error NotTheFatlinersHolder();
    error FatlinerHasVault();
    error NotAFatliner(); // an egg, or nothing
    error AlreadyHasCoin();
    error GenesisFirst(); // the genesis Fatliner's coin launches before any other
    error WrongTicker(); // the coin's symbol must be the Fatliner's surname

    constructor(address usdc_, address clanker_, address locker_, address feeLocker_, AppVault.Tier[] memory tiers_) {
        if (tiers_.length == 0) revert EmptyTiers();
        if (tiers_[0].minDau != 0) revert FirstTierMustBeOpen();
        deployer = msg.sender;
        usdc = usdc_;
        clanker = clanker_;
        locker = IClankerLpLocker(locker_);
        feeLocker = IClankerFeeLocker(feeLocker_);
        for (uint256 i; i < tiers_.length; i++) {
            _tiers.push(tiers_[i]);
        }
    }

    function tiers() external view returns (AppVault.Tier[] memory) {
        return _tiers;
    }

    function appsCount() external view returns (uint256) {
        return apps.length;
    }

    /// @notice The vault address `creator` will get for `salt`. Use it as the fee recipient when
    /// building the Clanker deployment, before calling `launchApp`.
    function predictVault(address creator, bytes32 salt) public view returns (address) {
        return _predict(_salt(creator, salt));
    }

    /// @notice The Fatliners contract, set once (it needs this factory's address, so it comes after).
    function setFatliners(address fatliners_) external {
        if (msg.sender != deployer) revert NotDeployer();
        if (fatliners != address(0)) revert AlreadySet();
        fatliners = fatliners_;
        emit FatlinersSet(fatliners_);
    }

    /// @notice Where the vault of Fatliner `fid` is, or will be. Royalties can be sent here before it exists.
    function predictFatlinerVault(uint256 fid) public view returns (address) {
        return _predict(_fatlinerSalt(fid));
    }

    /// @notice An app with no coin. It lives on deposits.
    function createApp(AppParams calldata p, uint256 deposit) external returns (AppVault vault) {
        vault = _create(p, _salt(msg.sender, p.salt), p.owner);
        _deposit(vault, deposit);
    }

    /// @notice A Fatliner's vault, with no coin. Only its holder can do this, once. `p.owner` and `p.salt`
    /// are ignored: the vault belongs to whoever holds the Fatliner.
    function createFatline(uint256 fid, AppParams calldata p, uint256 deposit) external returns (AppVault vault) {
        vault = _createFatline(fid, p);
        _deposit(vault, deposit);
    }

    /// @notice A Fatliner's vault and its coin. `deployCalldata`'s fees must go to `predictFatlinerVault(fid)`.
    /// @notice A Fatliner's coin (and its vault, if it has none yet). Only its holder, once. The coin's
    /// symbol must be the Fatliner's surname, and the genesis Fatliner's coin comes first.
    function launchFatline(uint256 fid, AppParams calldata p, bytes calldata deployCalldata, uint256 deposit)
        external
        payable
        returns (AppVault vault, address coin)
    {
        if (coinOfFatliner[fid] != address(0)) revert AlreadyHasCoin();
        if (coinsLaunched == 0 && fid != IFatliners(fatliners).genesisFid()) revert GenesisFirst();
        address existing = vaultOfFatliner[fid];
        if (existing == address(0)) {
            vault = _createFatline(fid, p);
        } else {
            _requireHolder(fid);
            vault = AppVault(payable(existing));
        }
        coin = _launch(vault, deployCalldata);
        if (keccak256(bytes(IERC20Symbol(coin).symbol())) != keccak256(bytes(IFatliners(fatliners).surnameOf(fid)))) {
            revert WrongTicker();
        }
        coinOfFatliner[fid] = coin;
        coinsLaunched++;
        _deposit(vault, deposit);
    }

    function _create(AppParams calldata p, bytes32 salt, address owner) internal returns (AppVault vault) {
        vault = new AppVault{salt: salt}();
        vault.initialize(usdc, locker, feeLocker, owner, p.keeper, _tiers, p.billingPeriod, p.uri);
        apps.push(address(vault));
        isApp[address(vault)] = true;
        emit AppCreated(address(vault), msg.sender, owner, p.uri);
    }

    /// @dev The caller must hold `fid`, and it must be a hatched Fatliner (not an egg).
    function _requireHolder(uint256 fid) internal view {
        if (fatliners == address(0)) revert NoFatliners();
        (bool ok, bytes memory ret) = fatliners.staticcall(abi.encodeWithSignature("ownerOf(uint256)", fid));
        if (!ok || ret.length < 32 || abi.decode(ret, (address)) != msg.sender) revert NotTheFatlinersHolder();
        if (!IFatliners(fatliners).isFatliner(fid)) revert NotAFatliner();
    }

    function _createFatline(uint256 fid, AppParams calldata p) internal returns (AppVault vault) {
        if (vaultOfFatliner[fid] != address(0)) revert FatlinerHasVault();
        _requireHolder(fid);
        vault = _create(p, _fatlinerSalt(fid), msg.sender);
        vault.bindToNft(fatliners, fid);
        vaultOfFatliner[fid] = address(vault);
        emit FatlineBorn(fid, address(vault));
    }

    function _predict(bytes32 salt) internal view returns (address) {
        bytes32 hash =
            keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, keccak256(type(AppVault).creationCode)));
        return address(uint160(uint256(hash)));
    }

    function _fatlinerSalt(uint256 fid) internal pure returns (bytes32) {
        return keccak256(abi.encode("fatliner", fid));
    }

    function _launch(AppVault vault, bytes calldata deployCalldata) internal returns (address coin) {
        if (deployCalldata.length < 4 || bytes4(deployCalldata[:4]) != IClanker.deployToken.selector) {
            revert NotDeployToken();
        }
        (bool ok, bytes memory ret) = clanker.call{value: msg.value}(deployCalldata);
        if (!ok) revert ClankerFailed(ret);
        coin = abi.decode(ret, (address));

        // Read what Clanker actually recorded, rather than trusting the calldata.
        TokenRewardInfo memory info = locker.tokenRewards(coin);
        if (
            info.token != coin || info.rewardRecipients.length != 1 || info.rewardRecipients[0] != address(vault)
                || info.rewardAdmins[0] != address(vault) || info.rewardBps[0] != 10_000
                || locker.feePreferences(coin, 0) != FEE_IN_PAIRED
        ) revert FeesNotLockedToVault();
        if (info.poolKey.currency0 != usdc && info.poolKey.currency1 != usdc) revert NotPairedWithUsdc();

        vault.setCoin(coin);
        vaultOfCoin[coin] = address(vault);
        emit CoinLaunched(address(vault), coin);
    }

    function _deposit(AppVault vault, uint256 amount) internal {
        if (amount == 0) return;
        usdc.safeTransferFrom(msg.sender, address(vault), amount);
    }

    function _salt(address creator, bytes32 salt) internal pure returns (bytes32) {
        return keccak256(abi.encode(creator, salt));
    }
}

interface IFatliners {
    function genesisFid() external view returns (uint256);
    function isFatliner(uint256 fid) external view returns (bool);
    function surnameOf(uint256 fid) external view returns (string memory);
}

interface IERC20Symbol {
    function symbol() external view returns (string memory);
}
