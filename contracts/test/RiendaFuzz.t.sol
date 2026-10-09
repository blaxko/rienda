// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Rienda} from "../src/Rienda.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";

contract RiendaFuzzTest is Test {
    Rienda internal rienda;
    MockUSDC internal usdc;

    address internal owner = makeAddr("owner");
    address internal agent = makeAddr("agent");
    address internal merchant = makeAddr("merchant");
    address internal attacker = makeAddr("attacker");

    uint256 internal constant START = 20_000 days;

    function setUp() public {
        vm.warp(START);
        usdc = new MockUSDC();
        rienda = new Rienda(address(usdc));
        usdc.mint(owner, type(uint128).max);
        vm.prank(owner);
        usdc.approve(address(rienda), type(uint256).max);
    }

    function _create(uint128 perPay, uint128 daily, uint128 ceiling, uint128 dep, uint8 strikes)
        internal
        returns (uint256 id)
    {
        address[] memory m = new address[](1);
        string[] memory l = new string[](1);
        m[0] = merchant;
        l[0] = "m";
        Rienda.ReinParams memory p = Rienda.ReinParams({
            agent: agent,
            perPayCap: perPay,
            dailyCap: daily,
            holdCeiling: ceiling,
            expiry: uint64(block.timestamp + 365 days),
            maxStrikes: strikes
        });
        vm.prank(owner);
        id = rienda.createRein(p, m, l, dep);
    }

    /// Any amount to an allowed merchant lands in exactly the FR-8 bucket, and money only moves on Paid.
    function testFuzz_pay_outcomeMatchesRules(uint128 perPay, uint128 daily, uint128 ceiling, uint128 dep, uint128 amount)
        public
    {
        perPay = uint128(bound(perPay, 1, 1e12));
        daily = uint128(bound(daily, perPay, 1e13));
        ceiling = uint128(bound(ceiling, perPay, 1e13));
        dep = uint128(bound(dep, 0, 1e13));
        amount = uint128(bound(amount, 1, 2e13));

        uint256 id = _create(perPay, daily, ceiling, dep, 3);
        uint256 contractBefore = usdc.balanceOf(address(rienda));

        vm.prank(agent);
        Rienda.Outcome o = rienda.pay(id, merchant, amount, "");
        Rienda.Rein memory r = rienda.getRein(id);

        if (amount > ceiling) {
            assertEq(uint8(o), uint8(Rienda.Outcome.Blocked));
            assertEq(r.strikes, 1);
        } else if (amount > perPay || amount > daily) {
            assertEq(uint8(o), uint8(Rienda.Outcome.Held));
            assertEq(r.strikes, 0);
        } else if (amount > dep) {
            assertEq(uint8(o), uint8(Rienda.Outcome.Blocked));
            assertEq(r.strikes, 0);
        } else {
            assertEq(uint8(o), uint8(Rienda.Outcome.Paid));
            assertEq(usdc.balanceOf(merchant), amount);
            assertEq(r.balance, dep - amount);
            assertEq(r.spentToday, amount);
        }

        if (o != Rienda.Outcome.Paid) {
            assertEq(usdc.balanceOf(merchant), 0);
            assertEq(usdc.balanceOf(address(rienda)), contractBefore);
        }
        assertEq(usdc.balanceOf(agent), 0);
    }

    /// A sequence of payments across arbitrary time jumps never lets spentToday exceed dailyCap.
    function testFuzz_pay_dailyCapNeverExceeded(uint128[8] memory amounts, uint32[8] memory jumps) public {
        uint128 daily = 20e6;
        uint256 id = _create(5e6, daily, 50e6, 1_000e6, 10);
        for (uint256 i = 0; i < 8; i++) {
            vm.warp(block.timestamp + uint256(jumps[i]) % 2 days);
            uint128 amt = uint128(bound(amounts[i], 1, 8e6));
            vm.prank(agent);
            try rienda.pay(id, merchant, amt, "") {} catch {}
            assertLe(rienda.getRein(id).spentToday, daily);
        }
    }

    /// The day window rolls exactly when the UTC calendar day changes.
    function testFuzz_dayWindow_resetsOnlyOnNewDay(uint32 offset) public {
        uint256 id = _create(5e6, 20e6, 50e6, 100e6, 10);
        vm.prank(agent);
        rienda.pay(id, merchant, 5e6, "");

        uint256 t = block.timestamp + (uint256(offset) % 5 days);
        vm.warp(t);
        vm.prank(agent);
        rienda.pay(id, merchant, 1e6, "");

        uint256 spent = rienda.getRein(id).spentToday;
        if (t / 1 days == START / 1 days) assertEq(spent, 6e6);
        else assertEq(spent, 1e6);
    }

    /// Non-merchants never receive funds, whatever the amount.
    function testFuzz_nonMerchant_neverPaid(address to, uint128 amount) public {
        vm.assume(to != merchant);
        amount = uint128(bound(amount, 1, type(uint128).max));
        uint256 id = _create(5e6, 20e6, 50e6, 100e6, 10);
        uint256 toBefore = usdc.balanceOf(to); // `to` may be the Rienda contract itself, which holds funds
        vm.prank(agent);
        Rienda.Outcome o = rienda.pay(id, to, amount, "");
        assertEq(uint8(o), uint8(Rienda.Outcome.Blocked));
        assertEq(usdc.balanceOf(to), toBefore);
        assertEq(rienda.getRein(id).balance, 100e6);
    }

    /// After maxStrikes striking blocks the rein is frozen and the next call reverts.
    function testFuzz_strikes_freezeExactlyAtMax(uint8 maxStrikes) public {
        maxStrikes = uint8(bound(maxStrikes, 1, 10));
        uint256 id = _create(5e6, 20e6, 50e6, 100e6, maxStrikes);
        for (uint256 i = 0; i < maxStrikes; i++) {
            assertEq(uint8(rienda.getRein(id).status), uint8(Rienda.Status.Active));
            vm.prank(agent);
            rienda.pay(id, attacker, 1e6, "");
        }
        assertEq(uint8(rienda.getRein(id).status), uint8(Rienda.Status.Frozen));
        vm.prank(agent);
        vm.expectRevert(Rienda.ReinFrozen.selector);
        rienda.pay(id, attacker, 1e6, "");
    }

    /// Approve moves exactly the held amount; deny moves nothing.
    function testFuzz_approveDeny_accounting(uint128 amount, bool approve) public {
        amount = uint128(bound(amount, 5e6 + 1, 50e6));
        uint256 id = _create(5e6, 20e6, 50e6, 100e6, 3);
        vm.prank(agent);
        rienda.pay(id, merchant, amount, "");
        vm.startPrank(owner);
        if (approve) rienda.approve(0);
        else rienda.deny(0);
        vm.stopPrank();
        assertEq(usdc.balanceOf(merchant), approve ? amount : 0);
        assertEq(rienda.getRein(id).balance, approve ? 100e6 - amount : 100e6);
        assertEq(rienda.getRein(id).openHeld, 0);
    }

    /// Memo length boundary at 140 bytes.
    function testFuzz_memoLength(uint8 len) public {
        uint256 id = _create(5e6, 20e6, 50e6, 100e6, 3);
        bytes memory b = new bytes(len);
        for (uint256 i = 0; i < len; i++) b[i] = "x";
        vm.prank(agent);
        if (len > 140) vm.expectRevert(Rienda.MemoTooLong.selector);
        rienda.pay(id, merchant, 1e6, string(b));
    }
}
