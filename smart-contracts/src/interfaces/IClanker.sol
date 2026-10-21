// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// Minimal interfaces for Clanker v4 (github.com/clanker-devco/v4-contracts), only what Infinicaster uses.
// Base mainnet: Clanker 0xE85A59c628F7d27878ACeB4bf3b35733630083a9,
// LP locker (v1.1, from clanker-sdk 4.2.19) 0xffA37784D619F228D8B379d287a4D7282e500762,
// ClankerFeeLocker 0xF3622742b1E446D92e45E22923Ef11C2fcD55D68.

struct PoolKey {
    address currency0;
    address currency1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
}

struct TokenRewardInfo {
    address token;
    PoolKey poolKey;
    uint256 positionId;
    uint256 numPositions;
    uint16[] rewardBps;
    address[] rewardAdmins;
    address[] rewardRecipients;
}

interface IClanker {
    struct TokenConfig {
        address tokenAdmin;
        string name;
        string symbol;
        bytes32 salt;
        string image;
        string metadata;
        string context;
        uint256 originatingChainId;
    }

    struct PoolConfig {
        address hook;
        address pairedToken;
        int24 tickIfToken0IsClanker;
        int24 tickSpacing;
        bytes poolData;
    }

    struct LockerConfig {
        address locker;
        address[] rewardAdmins;
        address[] rewardRecipients;
        uint16[] rewardBps;
        int24[] tickLower;
        int24[] tickUpper;
        uint16[] positionBps;
        bytes lockerData;
    }

    struct ExtensionConfig {
        address extension;
        uint256 msgValue;
        uint16 extensionBps;
        bytes extensionData;
    }

    struct MevModuleConfig {
        address mevModule;
        bytes mevModuleData;
    }

    struct DeploymentConfig {
        TokenConfig tokenConfig;
        PoolConfig poolConfig;
        LockerConfig lockerConfig;
        MevModuleConfig mevModuleConfig;
        ExtensionConfig[] extensionConfigs;
    }

    function deployToken(DeploymentConfig memory deploymentConfig) external payable returns (address tokenAddress);
}

interface IClankerLpLocker {
    function tokenRewards(address token) external view returns (TokenRewardInfo memory);
    /// @dev 0 = Both, 1 = Paired, 2 = Clanker
    function feePreferences(address token, uint256 index) external view returns (uint8);
    function collectRewards(address token) external;
}

interface IClankerFeeLocker {
    function claim(address feeOwner, address token) external;
    function availableFees(address feeOwner, address token) external view returns (uint256);
}
