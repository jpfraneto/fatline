// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AppVault} from "./AppVault.sol";
import {SafeToken} from "./SafeToken.sol";
import {IClanker, IClankerFeeLocker, IClankerLpLocker, TokenRewardInfo} from "./interfaces/IClanker.sol";

/// @title AppFactory
/// @notice Gives birth to Infinicaster apps. One transaction creates the app's USDC vault and,
/// if the creator wants one, launches the app's coin on Clanker paired with USDC.
///
/// The factory checks the launched coin onchain and reverts unless 100% of its trading fees go to
/// the app's vault, converted to USDC, with the vault as the only admin. Since the vault has no
/// function to change that, nobody (not the creator, not us) can ever redirect the fees.
contract AppFactory {
    using SafeToken for address;

    uint8 internal constant FEE_IN_PAIRED = 1;

    address public immutable usdc;
    address public immutable clanker;
    IClankerLpLocker public immutable locker;
    IClankerFeeLocker public immutable feeLocker;

    AppVault.Tier[] internal _tiers;

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

    error EmptyTiers();
    error FirstTierMustBeOpen();
    error NotDeployToken();
    error ClankerFailed(bytes reason);
    error FeesNotLockedToVault();
    error NotPairedWithUsdc();

    constructor(address usdc_, address clanker_, address locker_, address feeLocker_, AppVault.Tier[] memory tiers_) {
        if (tiers_.length == 0) revert EmptyTiers();
        if (tiers_[0].minDau != 0) revert FirstTierMustBeOpen();
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
        bytes32 hash = keccak256(
            abi.encodePacked(
                bytes1(0xff), address(this), _salt(creator, salt), keccak256(type(AppVault).creationCode)
            )
        );
        return address(uint160(uint256(hash)));
    }

    /// @notice An app with no coin. It lives on deposits.
    function createApp(AppParams calldata p, uint256 deposit) external returns (AppVault vault) {
        vault = _create(p);
        _deposit(vault, deposit);
    }

    /// @notice An app with a coin. `deployCalldata` is a Clanker `deployToken` call whose fees go
    /// 100% to `predictVault(msg.sender, p.salt)`, in USDC, with that vault as admin.
    function launchApp(AppParams calldata p, bytes calldata deployCalldata, uint256 deposit)
        external
        payable
        returns (AppVault vault, address coin)
    {
        vault = _create(p);
        coin = _launch(vault, deployCalldata);
        _deposit(vault, deposit);
    }

    /// @notice Same as `launchApp`, with a USDC permit signature, so there is no separate approval.
    function launchAppWithPermit(
        AppParams calldata p,
        bytes calldata deployCalldata,
        uint256 deposit,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external payable returns (AppVault vault, address coin) {
        if (deposit > 0) {
            // If someone front-ran the permit, the allowance is already there; continue.
            try IPermit(usdc).permit(msg.sender, address(this), deposit, deadline, v, r, s) {} catch {}
        }
        vault = _create(p);
        coin = _launch(vault, deployCalldata);
        _deposit(vault, deposit);
    }

    function _create(AppParams calldata p) internal returns (AppVault vault) {
        vault = new AppVault{salt: _salt(msg.sender, p.salt)}();
        vault.initialize(usdc, locker, feeLocker, p.owner, p.keeper, _tiers, p.billingPeriod, p.uri);
        apps.push(address(vault));
        isApp[address(vault)] = true;
        emit AppCreated(address(vault), msg.sender, p.owner, p.uri);
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

interface IPermit {
    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external;
}
