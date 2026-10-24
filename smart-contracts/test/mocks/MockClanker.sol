// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IClanker, PoolKey, TokenRewardInfo} from "../../src/interfaces/IClanker.sol";
import {MockUSDC} from "./MockUSDC.sol";

/// Stand-ins for Clanker's deployer, LP locker and fee locker. The fork test uses the real ones.
contract MockFeeLocker {
    mapping(address => mapping(address => uint256)) public fees;

    function store(address token, address feeOwner, uint256 amount) external {
        MockUSDC(token).transferFrom(msg.sender, address(this), amount);
        fees[feeOwner][token] += amount;
    }

    function availableFees(address feeOwner, address token) external view returns (uint256) {
        return fees[feeOwner][token];
    }

    function claim(address feeOwner, address token) external {
        uint256 amount = fees[feeOwner][token];
        require(amount > 0, "NoFeesToClaim");
        fees[feeOwner][token] = 0;
        MockUSDC(token).transfer(feeOwner, amount);
    }
}

contract MockLocker {
    mapping(address => TokenRewardInfo) internal _rewards;
    mapping(address => uint8[]) internal _prefs;
    uint256 public collected;

    function record(address token, TokenRewardInfo memory info, uint8[] memory prefs) external {
        _rewards[token] = info;
        _prefs[token] = prefs;
    }

    function tokenRewards(address token) external view returns (TokenRewardInfo memory) {
        return _rewards[token];
    }

    function feePreferences(address token, uint256 i) external view returns (uint8) {
        return _prefs[token][i];
    }

    function collectRewards(address) external {
        collected++;
    }
}

contract MockClanker {
    MockLocker public immutable locker;
    address public immutable usdc;

    constructor(MockLocker locker_, address usdc_) {
        locker = locker_;
        usdc = usdc_;
    }

    function deployToken(IClanker.DeploymentConfig memory c) external payable returns (address token) {
        MockUSDC t = new MockUSDC();
        t.setSymbol(c.tokenConfig.symbol);
        token = address(t);
        TokenRewardInfo memory info;
        info.token = token;
        info.poolKey = PoolKey(c.poolConfig.pairedToken, token, 0, 200, address(0));
        info.rewardBps = c.lockerConfig.rewardBps;
        info.rewardAdmins = c.lockerConfig.rewardAdmins;
        info.rewardRecipients = c.lockerConfig.rewardRecipients;
        locker.record(token, info, abi.decode(c.lockerConfig.lockerData, (uint8[])));
    }
}
