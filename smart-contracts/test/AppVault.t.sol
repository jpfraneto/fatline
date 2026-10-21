// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {AppFactory} from "../src/AppFactory.sol";
import {AppVault} from "../src/AppVault.sol";
import {IClanker, IClankerFeeLocker, IClankerLpLocker} from "../src/interfaces/IClanker.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {MockClanker, MockFeeLocker, MockLocker} from "./mocks/MockClanker.sol";

contract AppVaultTest is Test {
    MockUSDC usdc;
    MockLocker locker;
    MockFeeLocker feeLocker;
    MockClanker clanker;
    AppFactory factory;

    address creator = makeAddr("creator");
    address owner = makeAddr("owner"); // could be a Safe
    address keeper = makeAddr("keeper"); // the server's wallet
    address fan = makeAddr("fan");
    address trader = makeAddr("trader");

    uint256 constant SEED = 6; // USDC units per second
    uint256 constant GROW = 18;

    function setUp() public {
        vm.warp(1_792_600_000); // October 2026
        usdc = new MockUSDC();
        locker = new MockLocker();
        feeLocker = new MockFeeLocker();
        clanker = new MockClanker(locker, address(usdc));
        AppVault.Tier[] memory t = new AppVault.Tier[](2);
        t[0] = AppVault.Tier(uint64(SEED), 0);
        t[1] = AppVault.Tier(uint64(GROW), 100);
        factory = new AppFactory(address(usdc), address(clanker), address(locker), address(feeLocker), t);

        for (uint256 i; i < 3; i++) {
            address who = [creator, fan, trader][i];
            usdc.mint(who, 10_000e6);
            vm.prank(who);
            usdc.approve(address(factory), type(uint256).max);
        }
    }

    function params(bytes32 salt) internal view returns (AppFactory.AppParams memory) {
        return AppFactory.AppParams({owner: owner, keeper: keeper, billingPeriod: 30 days, uri: "ipfs://app", salt: salt});
    }

    function deployCall(address recipient, address admin, uint16 bps, uint8 pref, address paired)
        internal
        view
        returns (bytes memory)
    {
        IClanker.DeploymentConfig memory c;
        c.tokenConfig.originatingChainId = block.chainid;
        c.poolConfig.pairedToken = paired;
        c.lockerConfig.rewardRecipients = new address[](1);
        c.lockerConfig.rewardRecipients[0] = recipient;
        c.lockerConfig.rewardAdmins = new address[](1);
        c.lockerConfig.rewardAdmins[0] = admin;
        c.lockerConfig.rewardBps = new uint16[](1);
        c.lockerConfig.rewardBps[0] = bps;
        uint8[] memory prefs = new uint8[](1);
        prefs[0] = pref;
        c.lockerConfig.lockerData = abi.encode(prefs);
        return abi.encodeCall(IClanker.deployToken, (c));
    }

    function launch() internal returns (AppVault vault, address coin) {
        address predicted = factory.predictVault(creator, "app");
        vm.prank(creator);
        (vault, coin) = factory.launchApp(params("app"), deployCall(predicted, predicted, 10_000, 1, address(usdc)), 300e6);
        assertEq(address(vault), predicted);
    }

    // ------------------------------------------------------------ birth

    function test_LaunchInOneTransaction() public {
        (AppVault vault, address coin) = launch();
        assertEq(vault.coin(), coin);
        assertEq(factory.vaultOfCoin(coin), address(vault));
        assertEq(usdc.balanceOf(address(vault)), 300e6);
        assertEq(vault.owner(), owner);
        assertEq(vault.keeper(), keeper);
        assertEq(factory.appsCount(), 1);
    }

    function test_AppWithoutCoin() public {
        vm.prank(creator);
        AppVault vault = factory.createApp(params("nocoin"), 50e6);
        assertEq(vault.coin(), address(0));
        assertEq(usdc.balanceOf(address(vault)), 50e6);
        assertEq(vault.harvest(), 0);
    }

    function test_RevertWhen_FeesGoSomewhereElse() public {
        address predicted = factory.predictVault(creator, "app");
        address thief = makeAddr("thief");
        bytes[4] memory bad = [
            deployCall(thief, predicted, 10_000, 1, address(usdc)), // wrong recipient
            deployCall(predicted, creator, 10_000, 1, address(usdc)), // someone could redirect later
            deployCall(predicted, predicted, 10_000, 0, address(usdc)), // fees not converted to USDC
            deployCall(predicted, predicted, 5_000, 1, address(usdc)) // only half the fees
        ];
        for (uint256 i; i < bad.length; i++) {
            vm.prank(creator);
            vm.expectRevert(AppFactory.FeesNotLockedToVault.selector);
            factory.launchApp(params("app"), bad[i], 0);
        }
    }

    function test_RevertWhen_NotPairedWithUsdc() public {
        address predicted = factory.predictVault(creator, "app");
        vm.prank(creator);
        vm.expectRevert(AppFactory.NotPairedWithUsdc.selector);
        factory.launchApp(params("app"), deployCall(predicted, predicted, 10_000, 1, makeAddr("weth")), 0);
    }

    function test_RevertWhen_CalldataIsNotDeployToken() public {
        vm.prank(creator);
        vm.expectRevert(AppFactory.NotDeployToken.selector);
        factory.launchApp(params("app"), abi.encodeWithSignature("transfer(address,uint256)", creator, 1), 0);
    }

    // ------------------------------------------------------------ life

    function test_ServerPaysItselfOnePeriodAhead() public {
        (AppVault vault,) = launch();
        vm.prank(keeper);
        uint256 paid = vault.payCompute();
        assertEq(paid, SEED * 30 days);
        assertEq(usdc.balanceOf(keeper), SEED * 30 days);
        assertEq(vault.paidThrough(), block.timestamp + 30 days);

        // Nothing more is due until time passes.
        vm.prank(keeper);
        vm.expectRevert(AppVault.NothingToPay.selector);
        vault.payCompute();

        // A day later, one more day is due.
        vm.warp(block.timestamp + 1 days);
        vm.prank(keeper);
        assertEq(vault.payCompute(), SEED * 1 days);
    }

    function test_DailyBilling() public {
        (AppVault vault,) = launch();
        vm.prank(owner);
        vault.setBillingPeriod(1 days);
        vm.prank(keeper);
        assertEq(vault.payCompute(), SEED * 1 days);
    }

    function test_DiesWhenTheMoneyRunsOutAndComesBack() public {
        vm.prank(creator);
        AppVault vault = factory.createApp(params("small"), SEED * 10 days);
        assertEq(vault.aliveUntil(), block.timestamp + 10 days);

        vm.prank(keeper);
        assertEq(vault.payCompute(), SEED * 10 days); // only 10 days were funded
        vm.warp(block.timestamp + 12 days);
        assertFalse(vault.isAlive());

        vm.prank(keeper);
        vm.expectRevert(AppVault.NothingToPay.selector);
        vault.payCompute();

        // A fan feeds it. Time restarts now; the dead days are free.
        vm.startPrank(fan);
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(SEED * 5 days, "come back");
        vm.stopPrank();
        vm.prank(keeper);
        vault.payCompute();
        assertEq(vault.paidThrough(), block.timestamp + 5 days);
        assertTrue(vault.isAlive());
    }

    function test_TradingFeesKeepItAlive() public {
        (AppVault vault, address coin) = launch();
        // Trading happened: Clanker converted the fees to USDC and stored them for the vault.
        vm.startPrank(trader);
        usdc.approve(address(feeLocker), type(uint256).max);
        feeLocker.store(address(usdc), address(vault), 100e6);
        vm.stopPrank();

        assertEq(vault.pendingFees(), 100e6);
        assertEq(vault.aliveUntil(), block.timestamp + (400e6 / SEED));
        assertEq(vault.harvest(), 100e6);
        assertEq(usdc.balanceOf(address(vault)), 400e6);
        assertEq(locker.collected(), 1);
        coin; // silence
    }

    function test_OwnerHasAgencyButCannotTakeWhatIsPaid() public {
        (AppVault vault,) = launch();
        vm.prank(keeper);
        vault.payCompute(); // keeper holds 30 days
        uint256 left = usdc.balanceOf(address(vault));

        vm.prank(fan);
        vm.expectRevert(AppVault.NotOwner.selector);
        vault.withdraw(fan, 1);

        vm.prank(owner);
        vault.withdraw(owner, left); // buys other coins, pays people, anything
        assertEq(usdc.balanceOf(owner), left);
        assertEq(vault.aliveUntil(), vault.paidThrough()); // lives exactly as long as already paid
    }

    // ------------------------------------------------------------ power

    // ------------------------------------------------------------ presence (DAU onchain)

    function sign(AppVault vault, uint256 pk, uint256 day) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s_) = vm.sign(pk, vault.checkInDigest(day));
        return abi.encodePacked(r, s_, v);
    }

    /// `n` people sign a check-in for today; anyone submits them in one batch.
    function crowd(AppVault vault, uint256 n, uint256 seed) internal returns (uint256 counted) {
        address[] memory people = new address[](n);
        uint256[] memory days_ = new uint256[](n);
        bytes[] memory sigs = new bytes[](n);
        for (uint256 i; i < n; i++) {
            uint256 pk = uint256(keccak256(abi.encode(seed, i))) % (2 ** 255) + 1;
            people[i] = vm.addr(pk);
            days_[i] = vault.today();
            sigs[i] = sign(vault, pk, days_[i]);
        }
        vm.prank(keeper); // usually the app's server, but anyone may submit
        counted = vault.checkInFor(people, days_, sigs);
    }

    function test_CheckInDirectlyAndOnlyOncePerDay() public {
        (AppVault vault,) = launch();
        vm.prank(fan);
        vault.checkIn();
        assertEq(vault.dauOf(vault.today()), 1);
        assertTrue(vault.checkedIn(vault.today(), fan));
        vm.prank(fan);
        vm.expectRevert(AppVault.NotCounted.selector);
        vault.checkIn();
    }

    function test_SignedCheckInsCountedInOneBatch() public {
        (AppVault vault,) = launch();
        assertEq(crowd(vault, 50, 1), 50);
        assertEq(vault.dauOf(vault.today()), 50);
        // The same people again: nothing more is counted.
        assertEq(crowd(vault, 50, 1), 0);
        assertEq(vault.dauOf(vault.today()), 50);
    }

    function test_BadCheckInsAreSkippedNotFatal() public {
        (AppVault vault,) = launch();
        (address alice, uint256 alicePk) = makeAddrAndKey("alice");
        (address bob, uint256 bobPk) = makeAddrAndKey("bob");
        uint256 t = vault.today();
        address[] memory people = new address[](4);
        uint256[] memory days_ = new uint256[](4);
        bytes[] memory sigs = new bytes[](4);
        (people[0], days_[0], sigs[0]) = (alice, t, sign(vault, alicePk, t)); // valid
        (people[1], days_[1], sigs[1]) = (bob, t, sign(vault, alicePk, t)); // alice signing for bob
        (people[2], days_[2], sigs[2]) = (bob, t - 5, sign(vault, bobPk, t - 5)); // too old
        (people[3], days_[3], sigs[3]) = (bob, t, sign(vault, bobPk, t)); // valid
        assertEq(vault.checkInFor(people, days_, sigs), 2);

        // A check-in signed for another app does not count here.
        vm.prank(creator);
        AppVault other = factory.createApp(params("other"), 0);
        (uint8 v, bytes32 r, bytes32 s_) = vm.sign(alicePk, other.checkInDigest(t));
        sigs = new bytes[](1);
        sigs[0] = abi.encodePacked(r, s_, v);
        people = new address[](1);
        people[0] = alice;
        days_ = new uint256[](1);
        days_[0] = t;
        assertEq(other.checkInFor(people, days_, sigs), 1);
        assertEq(vault.dauOf(t), 2);
    }

    function test_TiersUnlockWithYesterdaysUsers() public {
        (AppVault vault,) = launch();
        crowd(vault, 120, 7);
        // Today's count is not final yet; tiers look at the last complete day.
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(AppVault.NotEnoughDau.selector, 0, 100));
        vault.setTier(1);

        vm.warp(block.timestamp + 1 days);
        assertEq(vault.dau(), 120);
        vm.prank(owner);
        vault.setTier(1);
        assertEq(vault.ratePerSecond(), GROW);

        // Going down is always allowed.
        vm.prank(owner);
        vault.setTier(0);
        assertEq(vault.ratePerSecond(), SEED);
    }

    function test_OptionallyOnlyHoldersCount() public {
        (AppVault vault, address coin) = launch();
        vm.prank(owner);
        vault.setMinCoinToCount(1e18);
        vm.prank(fan);
        vm.expectRevert(AppVault.NotCounted.selector);
        vault.checkIn();

        MockUSDC(coin).mint(fan, 1e18); // the mock coin is a mintable token
        vm.prank(fan);
        vault.checkIn();
        assertEq(vault.dauOf(vault.today()), 1);
    }

    function test_OwnershipTwoSteps() public {
        (AppVault vault,) = launch();
        address safe = makeAddr("safe");
        vm.prank(owner);
        vault.transferOwnership(safe);
        assertEq(vault.owner(), owner);
        vm.prank(safe);
        vault.acceptOwnership();
        assertEq(vault.owner(), safe);
    }

    function test_OnlyFactoryInitializes() public {
        (AppVault vault,) = launch();
        AppVault.Tier[] memory t = new AppVault.Tier[](1);
        (address l, address f) = (address(vault.locker()), address(vault.feeLocker()));
        vm.expectRevert(AppVault.NotFactory.selector);
        vault.initialize(address(usdc), IClankerLpLocker(l), IClankerFeeLocker(f), fan, fan, t, 1 days, "");
        vm.expectRevert(AppVault.NotFactory.selector);
        vault.setCoin(fan);
    }

    /// Whatever happens, the keeper is never paid beyond what came in, and never more than one period ahead.
    function testFuzz_NeverPaysMoreThanItHas(uint32[5] memory waits, uint64[5] memory deposits, bool[5] memory pays)
        public
    {
        vm.prank(creator);
        AppVault vault = factory.createApp(params("fuzz"), 0);
        vm.prank(fan);
        usdc.approve(address(vault), type(uint256).max);
        uint256 totalIn;
        for (uint256 i; i < 5; i++) {
            uint256 amount = bound(deposits[i], 0, 500e6);
            if (amount > 0) {
                vm.prank(fan);
                vault.deposit(amount, "");
                totalIn += amount;
            }
            vm.warp(block.timestamp + bound(waits[i], 0, 60 days));
            if (pays[i]) {
                (uint256 due,) = vault.computeDue();
                if (due > 0) {
                    vm.prank(keeper);
                    vault.payCompute();
                }
            }
            assertEq(usdc.balanceOf(keeper) + usdc.balanceOf(address(vault)), totalIn);
            assertLe(vault.paidThrough(), block.timestamp + 30 days);
        }
    }
}
