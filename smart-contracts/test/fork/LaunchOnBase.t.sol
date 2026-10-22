// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {AppFactory} from "../../src/AppFactory.sol";
import {AppVault} from "../../src/AppVault.sol";
import {PoolKey, TokenRewardInfo} from "../../src/interfaces/IClanker.sol";
import {Deploy} from "../../script/Deploy.s.sol";

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
}

struct SwapParams {
    bool zeroForOne;
    int256 amountSpecified;
    uint160 sqrtPriceLimitX96;
}

interface IPoolManager {
    function unlock(bytes calldata data) external returns (bytes memory);
    function swap(PoolKey memory key, SwapParams memory params, bytes calldata hookData) external returns (int256);
    function sync(address currency) external;
    function settle() external payable returns (uint256);
    function take(address currency, address to, uint256 amount) external;
}

/// Swaps an exact input through Uniswap v4, the way any trader's router would.
contract Swapper {
    IPoolManager constant PM = IPoolManager(0x498581fF718922c3f8e6A244956aF099B2652b2b);
    uint160 constant MIN_SQRT = 4295128739 + 1;
    uint160 constant MAX_SQRT = 1461446703485210103287273052203988822378723970342 - 1;

    function swap(PoolKey memory key, address tokenIn, uint256 amountIn) external returns (uint256 out) {
        out = abi.decode(PM.unlock(abi.encode(key, tokenIn, amountIn)), (uint256));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(PM));
        (PoolKey memory key, address tokenIn, uint256 amountIn) = abi.decode(data, (PoolKey, address, uint256));
        bool zeroForOne = tokenIn == key.currency0;
        int256 delta = PM.swap(
            key, SwapParams(zeroForOne, -int256(amountIn), zeroForOne ? MIN_SQRT : MAX_SQRT), ""
        );
        int128 d0 = int128(delta >> 128);
        int128 d1 = int128(delta);
        (int128 paid, int128 got) = zeroForOne ? (d0, d1) : (d1, d0);
        address tokenOut = zeroForOne ? key.currency1 : key.currency0;
        PM.sync(tokenIn);
        IERC20(tokenIn).transfer(address(PM), uint256(uint128(-paid)));
        PM.settle();
        PM.take(tokenOut, address(this), uint256(uint128(got)));
        return abi.encode(uint256(uint128(got)));
    }
}

/// Launches a real app coin through the real Clanker v4 contracts on a Base mainnet fork, trades
/// it, and checks that the trading fees reach the app's vault as USDC and keep the server alive.
///
///   BASE_RPC_URL=https://base.drpc.org forge test --match-path "test/fork/*" --ffi -vv
contract LaunchOnBaseTest is Test {
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant POOL_MANAGER = 0x498581fF718922c3f8e6A244956aF099B2652b2b; // holds plenty of USDC

    AppFactory factory;
    address creator = makeAddr("creator");
    address keeper = makeAddr("keeper");
    bool noFork;

    function setUp() public {
        string memory rpc = vm.envOr("BASE_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            noFork = true;
            return;
        }
        vm.createSelectFork(rpc);
        Deploy d = new Deploy();
        factory = new AppFactory(USDC, d.CLANKER(), d.LOCKER(), d.FEE_LOCKER(), d.defaultTiers());
        vm.prank(POOL_MANAGER);
        IERC20(USDC).transfer(creator, 10_000e6);
    }

    function test_LaunchTradeAndLive() public {
        if (noFork) return console.log("skipped: set BASE_RPC_URL to run against a Base fork");

        // 1. Build the Clanker launch with the official SDK, exactly like ./fatline launch.
        address vaultAddr = factory.predictVault(creator, "opinions");
        string[] memory cmd = new string[](9);
        (cmd[0], cmd[1], cmd[2], cmd[3]) = ("node", "../indexer/src/launch.mjs", vm.toString(vaultAddr), vm.toString(creator));
        (cmd[4], cmd[5], cmd[6], cmd[7], cmd[8]) = ("Opinions", "OPINE", "", "8453", "25000");
        bytes memory deployCalldata = vm.ffi(cmd);

        // 2. One transaction: vault + coin + 100 USDC of life.
        vm.startPrank(creator);
        IERC20(USDC).approve(address(factory), 100e6);
        AppFactory.AppParams memory p = AppFactory.AppParams(creator, keeper, 30 days, "ipfs://opinions", "opinions");
        (AppVault vault, address coin) = factory.launchApp(p, deployCalldata, 100e6);
        vm.stopPrank();
        assertEq(address(vault), vaultAddr);
        console.log("coin", coin);
        console.log("vault", address(vault));

        TokenRewardInfo memory info = factory.locker().tokenRewards(coin);
        assertTrue(info.poolKey.currency0 == USDC || info.poolKey.currency1 == USDC);

        // 3. Let the anti-sniper period pass, then people trade.
        vm.roll(block.number + 100);
        vm.warp(block.timestamp + 1 hours);
        Swapper trader = new Swapper();
        vm.prank(POOL_MANAGER);
        IERC20(USDC).transfer(address(trader), 5_000e6);
        uint256 coins = trader.swap(info.poolKey, USDC, 5_000e6); // buy
        assertGt(coins, 0);
        trader.swap(info.poolKey, coin, coins / 2); // sell half
        console.log("bought coins", coins / 1e18);

        // 4. Anyone harvests: fees become USDC in the vault.
        uint256 before = IERC20(USDC).balanceOf(address(vault));
        uint256 harvested = vault.harvest();
        uint256 afterHarvest = IERC20(USDC).balanceOf(address(vault));
        console.log("fees harvested (USDC units)", harvested);
        assertGt(harvested, 0);
        assertEq(afterHarvest, before + harvested);

        // 5. The server pays itself for the next 30 days from that pile.
        vm.prank(keeper);
        uint256 paid = vault.payCompute();
        console.log("keeper paid (USDC units)", paid);
        assertEq(IERC20(USDC).balanceOf(keeper), paid);
        assertGt(vault.aliveUntil(), block.timestamp + 30 days);
    }
}
