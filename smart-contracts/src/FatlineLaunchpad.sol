// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {AppVault} from "./AppVault.sol";
import {SafeToken} from "./SafeToken.sol";
import {IClanker, IClankerFeeLocker, IClankerLpLocker, TokenRewardInfo} from "./interfaces/IClanker.sol";

/// @title FatlineLaunchpad
/// @notice The launchpad half of the Fatliners contract (Fatliners inherits it: one contract, not two).
///
/// At most 777 coins, ever: one per egg or Fatliner, launched by whoever holds it. Each gets one vault, at an
/// address known before it exists (`predictFatlinerVault`), owned by whoever holds that token, and one coin on
/// Clanker, paired with USDC. The coin's ticker is the surname read from the egg's DNA (`surnameOf`): nobody
/// picks it, not even the holder. The genesis Fatliner's coin ($FATLINE) comes first.
///
/// The launch is checked onchain: it reverts unless 100% of the coin's trading fees go to the vault, converted
/// to USDC, with the vault as the only admin. The vault has no function to change that, so nobody (not the
/// holder, not us) can ever redirect the fees.
///
/// Vaults are minimal clones (EIP-1167) of one AppVault, deployed with this contract.
abstract contract FatlineLaunchpad {
    using SafeToken for address;

    uint8 internal constant FEE_IN_PAIRED = 1;
    uint256 public constant MAX_COINS = 777;

    address public immutable usdc;
    address public immutable clanker;
    IClankerLpLocker public immutable locker;
    IClankerFeeLocker public immutable feeLocker;
    address public immutable vaultImplementation;

    AppVault.Tier[] internal _tiers;

    mapping(uint256 fid => address vault) public vaultOfFatliner;
    mapping(uint256 fid => address coin) public coinOfFatliner;
    mapping(address coin => address vault) public vaultOfCoin;
    uint256 public coinsLaunched; // at most MAX_COINS

    struct Clanker {
        address usdc;
        address clanker;
        address locker;
        address feeLocker;
    }

    struct AppParams {
        address owner; // ignored for a Fatliner's vault: its owner is whoever holds the token
        address keeper; // the server wallet that pays for compute
        uint256 billingPeriod; // seconds the keeper may pay ahead (1 to 31 days)
        string uri; // the app's description and experience
        bytes32 salt; // ignored for a Fatliner's vault
    }

    event AppCreated(address indexed vault, address indexed creator, address indexed owner, string uri);
    event CoinLaunched(address indexed vault, address indexed coin);
    event FatlineBorn(uint256 indexed fid, address indexed vault);

    error EmptyTiers();
    error FirstTierMustBeOpen();
    error NotDeployToken();
    error ClankerFailed(bytes reason);
    error FeesNotLockedToVault();
    error NotPairedWithUsdc();
    error NotTheFatlinersHolder();
    error FatlinerHasVault();
    error NotAFatliner(); // no egg, no Fatliner
    error AlreadyHasCoin();
    error GenesisFirst(); // the genesis Fatliner's coin launches before any other
    error WrongTicker(); // the coin's symbol must be the surname
    error AllCoinsLaunched(); // 777, ever

    constructor(Clanker memory c, AppVault.Tier[] memory tiers_) {
        if (tiers_.length == 0) revert EmptyTiers();
        if (tiers_[0].minDau != 0) revert FirstTierMustBeOpen();
        usdc = c.usdc;
        clanker = c.clanker;
        locker = IClankerLpLocker(c.locker);
        feeLocker = IClankerFeeLocker(c.feeLocker);
        vaultImplementation = address(new AppVault()); // its `factory` is this contract
        for (uint256 i; i < tiers_.length; i++) {
            _tiers.push(tiers_[i]);
        }
    }

    // What the token side answers (Fatliners implements these).
    function _holderOf(uint256 fid) internal view virtual returns (address);
    function _hasCoinRight(uint256 fid) internal view virtual returns (bool);
    function _tickerOf(uint256 fid) internal view virtual returns (string memory);
    function _genesis() internal view virtual returns (uint256);

    function tiers() external view returns (AppVault.Tier[] memory) {
        return _tiers;
    }

    /// @notice Where the vault of egg or Fatliner `fid` is, or will be. Royalties can be sent here before it exists.
    function predictFatlinerVault(uint256 fid) public view returns (address) {
        return Clones.predictDeterministicAddress(vaultImplementation, _fatlinerSalt(fid));
    }

    /// @notice A vault with no coin yet. Only the holder, once. It belongs to whoever holds the token.
    function createFatline(uint256 fid, AppParams calldata p, uint256 deposit) external returns (AppVault vault) {
        vault = _createFatline(fid, p);
        _deposit(vault, deposit);
    }

    /// @notice The coin of an egg or a Fatliner (and its vault, if it has none yet). Only its holder, once.
    /// The coin's symbol must be its surname; the genesis Fatliner's comes first; 777 coins, ever.
    function launchFatline(uint256 fid, AppParams calldata p, bytes calldata deployCalldata, uint256 deposit)
        external
        payable
        returns (AppVault vault, address coin)
    {
        if (coinOfFatliner[fid] != address(0)) revert AlreadyHasCoin();
        if (coinsLaunched >= MAX_COINS) revert AllCoinsLaunched();
        if (coinsLaunched == 0 && fid != _genesis()) revert GenesisFirst();
        address existing = vaultOfFatliner[fid];
        if (existing == address(0)) {
            vault = _createFatline(fid, p);
        } else {
            _requireHolder(fid);
            vault = AppVault(payable(existing));
        }
        coin = _launch(vault, deployCalldata);
        if (keccak256(bytes(IERC20Symbol(coin).symbol())) != keccak256(bytes(_tickerOf(fid)))) revert WrongTicker();
        coinOfFatliner[fid] = coin;
        coinsLaunched++;
        _deposit(vault, deposit);
    }

    function _create(AppParams calldata p, bytes32 salt, address owner) internal returns (AppVault vault) {
        vault = AppVault(payable(Clones.cloneDeterministic(vaultImplementation, salt)));
        vault.initialize(usdc, locker, feeLocker, owner, p.keeper, _tiers, p.billingPeriod, p.uri);
        emit AppCreated(address(vault), msg.sender, owner, p.uri);
    }

    function _requireHolder(uint256 fid) internal view {
        if (!_hasCoinRight(fid)) revert NotAFatliner();
        if (_holderOf(fid) != msg.sender) revert NotTheFatlinersHolder();
    }

    function _createFatline(uint256 fid, AppParams calldata p) internal returns (AppVault vault) {
        if (vaultOfFatliner[fid] != address(0)) revert FatlinerHasVault();
        _requireHolder(fid);
        vault = _create(p, _fatlinerSalt(fid), msg.sender);
        vault.bindToNft(address(this), fid);
        vaultOfFatliner[fid] = address(vault);
        emit FatlineBorn(fid, address(vault));
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
}

interface IERC20Symbol {
    function symbol() external view returns (string memory);
}
