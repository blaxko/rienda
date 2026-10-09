// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Rienda} from "../src/Rienda.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";

contract RiendaTest is Test {
    Rienda internal rienda;
    MockUSDC internal usdc;

    address internal owner = makeAddr("owner");
    address internal agent = makeAddr("agent");
    address internal news = makeAddr("news");
    address internal gpu = makeAddr("gpu");
    address internal attacker = makeAddr("attacker");
    address internal stranger = makeAddr("stranger");

    uint128 internal constant U = 1e6;
    uint256 internal constant DAY0 = 20_000 days; // start of a UTC day
    uint128 internal constant PER_PAY = 5 * U;
    uint128 internal constant DAILY = 20 * U;
    uint128 internal constant CEILING = 50 * U;
    uint128 internal constant DEPOSIT = 30 * U;

    uint256 internal reinId;

    // events (redeclared for vm.expectEmit)
    event ReinCreated(uint256 indexed reinId, address indexed owner, address indexed agent);
    event MerchantSet(uint256 indexed reinId, address indexed merchant, bool allowed, string label);
    event LimitsSet(
        uint256 indexed reinId,
        uint128 perPayCap,
        uint128 dailyCap,
        uint128 holdCeiling,
        uint64 expiry,
        uint8 maxStrikes
    );
    event Deposited(uint256 indexed reinId, uint128 amount);
    event Withdrawn(uint256 indexed reinId, uint128 amount);
    event Paid(uint256 indexed reinId, address indexed to, uint128 amount, string memo);
    event Held(
        uint256 indexed reinId, uint256 indexed requestId, address indexed to, uint128 amount, string memo
    );
    event Blocked(
        uint256 indexed reinId, address indexed to, uint128 amount, Rienda.Reason reason, uint8 strikes, string memo
    );
    event Frozen(uint256 indexed reinId, bool auto_);
    event Unfrozen(uint256 indexed reinId);
    event Approved(uint256 indexed requestId);
    event Denied(uint256 indexed requestId);
    event Closed(uint256 indexed reinId);

    function setUp() public {
        vm.warp(DAY0 + 12 hours);
        usdc = new MockUSDC();
        rienda = new Rienda(address(usdc));
        usdc.mint(owner, 1_000 * U);
        vm.prank(owner);
        usdc.approve(address(rienda), type(uint256).max);
        reinId = _create(DEPOSIT);
    }

    // ───────────── helpers ─────────────

    function _params() internal view returns (Rienda.ReinParams memory) {
        return Rienda.ReinParams({
            agent: agent,
            perPayCap: PER_PAY,
            dailyCap: DAILY,
            holdCeiling: CEILING,
            expiry: uint64(block.timestamp + 7 days),
            maxStrikes: 3
        });
    }

    function _merchants() internal view returns (address[] memory m, string[] memory l) {
        m = new address[](2);
        l = new string[](2);
        m[0] = news;
        l[0] = "News API";
        m[1] = gpu;
        l[1] = "GPU minutes";
    }

    function _create(uint128 dep) internal returns (uint256 id) {
        (address[] memory m, string[] memory l) = _merchants();
        vm.prank(owner);
        id = rienda.createRein(_params(), m, l, dep);
    }

    function _pay(address to, uint128 amount) internal returns (Rienda.Outcome o) {
        vm.prank(agent);
        o = rienda.pay(reinId, to, amount, "memo");
    }

    function _rein() internal view returns (Rienda.Rein memory) {
        return rienda.getRein(reinId);
    }

    // ───────────── createRein ─────────────

    function test_createRein_valid_emitsAndStores() public {
        (address[] memory m, string[] memory l) = _merchants();
        Rienda.ReinParams memory p = _params();
        uint256 expectedId = rienda.nextReinId();

        vm.expectEmit(true, true, true, true);
        emit ReinCreated(expectedId, owner, agent);
        vm.expectEmit(true, false, false, true);
        emit LimitsSet(expectedId, p.perPayCap, p.dailyCap, p.holdCeiling, p.expiry, p.maxStrikes);
        vm.expectEmit(true, true, false, true);
        emit MerchantSet(expectedId, news, true, "News API");
        vm.expectEmit(true, true, false, true);
        emit MerchantSet(expectedId, gpu, true, "GPU minutes");
        vm.expectEmit(true, false, false, true);
        emit Deposited(expectedId, DEPOSIT);

        vm.prank(owner);
        uint256 id = rienda.createRein(p, m, l, DEPOSIT);

        assertEq(id, expectedId);
        Rienda.Rein memory r = rienda.getRein(id);
        assertEq(r.owner, owner);
        assertEq(r.agent, agent);
        assertEq(r.balance, DEPOSIT);
        assertEq(r.perPayCap, PER_PAY);
        assertEq(r.dailyCap, DAILY);
        assertEq(r.holdCeiling, CEILING);
        assertEq(r.maxStrikes, 3);
        assertEq(uint8(r.status), uint8(Rienda.Status.Active));
        assertTrue(rienda.isMerchant(id, news));
        assertTrue(rienda.isMerchant(id, gpu));
        assertFalse(rienda.isMerchant(id, attacker));
        assertEq(usdc.balanceOf(address(rienda)), DEPOSIT * 2); // setUp rein + this one
    }

    function test_createRein_zeroDeposit_ok() public {
        uint256 id = _create(0);
        assertEq(rienda.getRein(id).balance, 0);
    }

    function test_createRein_revert_zeroAgent() public {
        Rienda.ReinParams memory p = _params();
        p.agent = address(0);
        (address[] memory m, string[] memory l) = _merchants();
        vm.prank(owner);
        vm.expectRevert(Rienda.ZeroAddress.selector);
        rienda.createRein(p, m, l, 0);
    }

    function test_createRein_revert_agentIsOwner() public {
        Rienda.ReinParams memory p = _params();
        p.agent = owner;
        (address[] memory m, string[] memory l) = _merchants();
        vm.prank(owner);
        vm.expectRevert(Rienda.AgentIsOwner.selector);
        rienda.createRein(p, m, l, 0);
    }

    function test_createRein_revert_zeroPerPayCap() public {
        Rienda.ReinParams memory p = _params();
        p.perPayCap = 0;
        (address[] memory m, string[] memory l) = _merchants();
        vm.prank(owner);
        vm.expectRevert(Rienda.InvalidLimits.selector);
        rienda.createRein(p, m, l, 0);
    }

    function test_createRein_revert_perPayAboveDaily() public {
        Rienda.ReinParams memory p = _params();
        p.perPayCap = DAILY + 1;
        p.holdCeiling = CEILING;
        (address[] memory m, string[] memory l) = _merchants();
        vm.prank(owner);
        vm.expectRevert(Rienda.InvalidLimits.selector);
        rienda.createRein(p, m, l, 0);
    }

    function test_createRein_revert_perPayAboveCeiling() public {
        Rienda.ReinParams memory p = _params();
        p.holdCeiling = PER_PAY - 1;
        (address[] memory m, string[] memory l) = _merchants();
        vm.prank(owner);
        vm.expectRevert(Rienda.InvalidLimits.selector);
        rienda.createRein(p, m, l, 0);
    }

    function test_createRein_revert_expiryNotFuture() public {
        Rienda.ReinParams memory p = _params();
        p.expiry = uint64(block.timestamp);
        (address[] memory m, string[] memory l) = _merchants();
        vm.prank(owner);
        vm.expectRevert(Rienda.InvalidExpiry.selector);
        rienda.createRein(p, m, l, 0);
    }

    function test_createRein_revert_maxStrikesZero() public {
        Rienda.ReinParams memory p = _params();
        p.maxStrikes = 0;
        (address[] memory m, string[] memory l) = _merchants();
        vm.prank(owner);
        vm.expectRevert(Rienda.InvalidMaxStrikes.selector);
        rienda.createRein(p, m, l, 0);
    }

    function test_createRein_revert_maxStrikesAboveTen() public {
        Rienda.ReinParams memory p = _params();
        p.maxStrikes = 11;
        (address[] memory m, string[] memory l) = _merchants();
        vm.prank(owner);
        vm.expectRevert(Rienda.InvalidMaxStrikes.selector);
        rienda.createRein(p, m, l, 0);
    }

    function test_createRein_revert_lengthMismatch() public {
        (address[] memory m,) = _merchants();
        string[] memory l = new string[](1);
        vm.prank(owner);
        vm.expectRevert(Rienda.LengthMismatch.selector);
        rienda.createRein(_params(), m, l, 0);
    }

    function test_createRein_revert_zeroMerchant() public {
        address[] memory m = new address[](1);
        string[] memory l = new string[](1);
        vm.prank(owner);
        vm.expectRevert(Rienda.ZeroAddress.selector);
        rienda.createRein(_params(), m, l, 0);
    }

    function test_constructor_revert_zeroUsdc() public {
        vm.expectRevert(Rienda.ZeroAddress.selector);
        new Rienda(address(0));
    }

    // ───────────── pay: outcomes ─────────────

    function test_pay_paid() public {
        vm.expectEmit(true, true, false, true);
        emit Paid(reinId, news, 2 * U, "memo");
        Rienda.Outcome o = _pay(news, 2 * U);

        assertEq(uint8(o), uint8(Rienda.Outcome.Paid));
        assertEq(usdc.balanceOf(news), 2 * U);
        assertEq(_rein().balance, DEPOSIT - 2 * U);
        assertEq(_rein().spentToday, 2 * U);
        assertEq(_rein().strikes, 0);
    }

    function test_pay_exactlyPerPayCap_paid() public {
        assertEq(uint8(_pay(news, PER_PAY)), uint8(Rienda.Outcome.Paid));
    }

    function test_pay_held_overPerPayCap() public {
        vm.expectEmit(true, true, true, true);
        emit Held(reinId, 0, gpu, 12 * U, "memo");
        Rienda.Outcome o = _pay(gpu, 12 * U);

        assertEq(uint8(o), uint8(Rienda.Outcome.Held));
        assertEq(usdc.balanceOf(gpu), 0);
        assertEq(_rein().balance, DEPOSIT);
        assertEq(_rein().strikes, 0);
        assertEq(_rein().openHeld, 1);
        (uint256 rid, address to, uint128 amt,, Rienda.ReqStatus st) = rienda.requests(0);
        assertEq(rid, reinId);
        assertEq(to, gpu);
        assertEq(amt, 12 * U);
        assertEq(uint8(st), uint8(Rienda.ReqStatus.Pending));
        assertEq(rienda.nextRequestId(), 1);
    }

    function test_pay_held_overDailyCap() public {
        for (uint256 i = 0; i < 4; i++) {
            assertEq(uint8(_pay(news, PER_PAY)), uint8(Rienda.Outcome.Paid)); // 20 spent
        }
        assertEq(_rein().spentToday, DAILY);
        assertEq(uint8(_pay(news, 1 * U)), uint8(Rienda.Outcome.Held));
        assertEq(_rein().spentToday, DAILY);
        assertEq(_rein().strikes, 0);
    }

    function test_pay_held_beatsNoFunds() public {
        // Held is checked before NO_FUNDS: a big request beyond balance is still held (FR-8 order)
        vm.expectEmit(true, true, true, true);
        emit Held(reinId, 0, news, 40 * U, "memo");
        assertEq(uint8(_pay(news, 40 * U)), uint8(Rienda.Outcome.Held));
    }

    function test_pay_blocked_notAllowed() public {
        vm.expectEmit(true, true, false, true);
        emit Blocked(reinId, attacker, 500 * U / 100, Rienda.Reason.NOT_ALLOWED, 1, "memo");
        Rienda.Outcome o = _pay(attacker, 5 * U);

        assertEq(uint8(o), uint8(Rienda.Outcome.Blocked));
        assertEq(usdc.balanceOf(attacker), 0);
        assertEq(_rein().balance, DEPOSIT);
        assertEq(_rein().strikes, 1);
    }

    function test_pay_blocked_aboveCeiling() public {
        vm.expectEmit(true, true, false, true);
        emit Blocked(reinId, news, CEILING + 1, Rienda.Reason.ABOVE_CEILING, 1, "memo");
        assertEq(uint8(_pay(news, CEILING + 1)), uint8(Rienda.Outcome.Blocked));
        assertEq(_rein().strikes, 1);
        assertEq(_rein().openHeld, 0);
    }

    function test_pay_atCeiling_isHeldNotBlocked() public {
        assertEq(uint8(_pay(news, CEILING)), uint8(Rienda.Outcome.Held));
    }

    function test_pay_notAllowed_beatsAboveCeiling() public {
        // FR-8 order: allowlist first
        vm.expectEmit(true, true, false, true);
        emit Blocked(reinId, attacker, 500 * U, Rienda.Reason.NOT_ALLOWED, 1, "memo");
        _pay(attacker, 500 * U);
    }

    function test_pay_blocked_tooManyHeld() public {
        for (uint256 i = 0; i < 5; i++) {
            assertEq(uint8(_pay(news, 6 * U)), uint8(Rienda.Outcome.Held));
        }
        assertEq(_rein().openHeld, 5);

        vm.expectEmit(true, true, false, true);
        emit Blocked(reinId, news, 6 * U, Rienda.Reason.TOO_MANY_HELD, 1, "memo");
        assertEq(uint8(_pay(news, 6 * U)), uint8(Rienda.Outcome.Blocked));
        assertEq(_rein().strikes, 1);
        assertEq(_rein().openHeld, 5);
    }

    function test_pay_blocked_tooManyHeld_alsoBlocksSmallPayments() public {
        for (uint256 i = 0; i < 5; i++) {
            _pay(news, 6 * U);
        }
        // even a payable amount hits the TOO_MANY_HELD check first (FR-8 step 3 before step 6)
        assertEq(uint8(_pay(news, 1 * U)), uint8(Rienda.Outcome.Blocked));
    }

    function test_pay_blocked_noFunds_noStrike() public {
        uint256 id = _create(1 * U);
        vm.expectEmit(true, true, false, true);
        emit Blocked(id, news, 2 * U, Rienda.Reason.NO_FUNDS, 0, "memo");
        vm.prank(agent);
        Rienda.Outcome o = rienda.pay(id, news, 2 * U, "memo");

        assertEq(uint8(o), uint8(Rienda.Outcome.Blocked));
        assertEq(rienda.getRein(id).strikes, 0);
        assertEq(rienda.getRein(id).balance, 1 * U);
        assertEq(usdc.balanceOf(news), 0);
    }

    function test_pay_noFunds_repeatedNeverFreezes() public {
        uint256 id = _create(0);
        for (uint256 i = 0; i < 10; i++) {
            vm.prank(agent);
            rienda.pay(id, news, 1 * U, "");
        }
        assertEq(uint8(rienda.getRein(id).status), uint8(Rienda.Status.Active));
    }

    // ───────────── pay: reverts (FR-7) ─────────────

    function test_pay_revert_notAgent() public {
        vm.prank(stranger);
        vm.expectRevert(Rienda.NotAgent.selector);
        rienda.pay(reinId, news, 1 * U, "");

        vm.prank(owner);
        vm.expectRevert(Rienda.NotAgent.selector);
        rienda.pay(reinId, news, 1 * U, "");
    }

    function test_pay_revert_unknownRein() public {
        vm.prank(agent);
        vm.expectRevert(Rienda.ReinNotFound.selector);
        rienda.pay(999, news, 1 * U, "");
    }

    function test_pay_revert_frozen() public {
        vm.prank(owner);
        rienda.freeze(reinId);
        vm.prank(agent);
        vm.expectRevert(Rienda.ReinFrozen.selector);
        rienda.pay(reinId, news, 1 * U, "");
    }

    function test_pay_revert_closed() public {
        vm.prank(owner);
        rienda.close(reinId);
        vm.prank(agent);
        vm.expectRevert(Rienda.ReinNotActive.selector);
        rienda.pay(reinId, news, 1 * U, "");
    }

    function test_pay_revert_expired() public {
        vm.warp(_rein().expiry);
        vm.prank(agent);
        vm.expectRevert(Rienda.ReinExpired.selector);
        rienda.pay(reinId, news, 1 * U, "");
    }

    function test_pay_justBeforeExpiry_ok() public {
        vm.warp(_rein().expiry - 1);
        assertEq(uint8(_pay(news, 1 * U)), uint8(Rienda.Outcome.Paid));
    }

    function test_pay_revert_zeroAmount() public {
        vm.prank(agent);
        vm.expectRevert(Rienda.ZeroAmount.selector);
        rienda.pay(reinId, news, 0, "");
    }

    function test_pay_revert_memoTooLong() public {
        bytes memory b = new bytes(141);
        for (uint256 i = 0; i < b.length; i++) {
            b[i] = "a";
        }
        vm.prank(agent);
        vm.expectRevert(Rienda.MemoTooLong.selector);
        rienda.pay(reinId, news, 1 * U, string(b));
    }

    function test_pay_memo140Bytes_ok() public {
        bytes memory b = new bytes(140);
        for (uint256 i = 0; i < b.length; i++) {
            b[i] = "a";
        }
        vm.prank(agent);
        assertEq(uint8(rienda.pay(reinId, news, 1 * U, string(b))), uint8(Rienda.Outcome.Paid));
    }

    // ───────────── strikes & freeze ─────────────

    function test_strikes_thirdEmitsBlockedAndFrozen_thenPayReverts() public {
        _pay(attacker, 500 * U);
        assertEq(_rein().strikes, 1);
        _pay(attacker, 500 * U);
        assertEq(_rein().strikes, 2);
        assertEq(uint8(_rein().status), uint8(Rienda.Status.Active));

        vm.expectEmit(true, true, false, true);
        emit Blocked(reinId, attacker, 500 * U, Rienda.Reason.NOT_ALLOWED, 3, "memo");
        vm.expectEmit(true, false, false, true);
        emit Frozen(reinId, true);
        _pay(attacker, 500 * U);

        assertEq(uint8(_rein().status), uint8(Rienda.Status.Frozen));
        assertEq(_rein().balance, DEPOSIT);
        assertEq(usdc.balanceOf(attacker), 0);

        vm.prank(agent);
        vm.expectRevert(Rienda.ReinFrozen.selector);
        rienda.pay(reinId, attacker, 500 * U, "");
    }

    function test_strikes_noFundsDoesNotCount() public {
        uint256 id = _create(0);
        vm.startPrank(agent);
        rienda.pay(id, news, 1 * U, "");
        rienda.pay(id, attacker, 1 * U, ""); // strike 1
        rienda.pay(id, news, 1 * U, "");
        vm.stopPrank();
        assertEq(rienda.getRein(id).strikes, 1);
    }

    function test_strikes_heldDoesNotCount() public {
        _pay(news, 6 * U);
        assertEq(_rein().strikes, 0);
    }

    function test_owner_freeze_unfreeze() public {
        _pay(attacker, 1 * U);
        _pay(attacker, 1 * U);

        vm.expectEmit(true, false, false, true);
        emit Frozen(reinId, false);
        vm.prank(owner);
        rienda.freeze(reinId);
        assertEq(uint8(_rein().status), uint8(Rienda.Status.Frozen));
        assertEq(_rein().strikes, 2);

        vm.expectEmit(true, false, false, false);
        emit Unfrozen(reinId);
        vm.prank(owner);
        rienda.unfreeze(reinId);
        assertEq(uint8(_rein().status), uint8(Rienda.Status.Active));
        assertEq(_rein().strikes, 0);

        assertEq(uint8(_pay(news, 1 * U)), uint8(Rienda.Outcome.Paid));
    }

    function test_freeze_revert_alreadyFrozen() public {
        vm.startPrank(owner);
        rienda.freeze(reinId);
        vm.expectRevert(Rienda.AlreadyFrozen.selector);
        rienda.freeze(reinId);
        vm.stopPrank();
    }

    function test_unfreeze_revert_notFrozen() public {
        vm.prank(owner);
        vm.expectRevert(Rienda.NotFrozen.selector);
        rienda.unfreeze(reinId);
    }

    function test_freeze_unfreeze_revert_closed() public {
        vm.startPrank(owner);
        rienda.close(reinId);
        vm.expectRevert(Rienda.ReinClosed.selector);
        rienda.freeze(reinId);
        vm.expectRevert(Rienda.ReinClosed.selector);
        rienda.unfreeze(reinId);
        vm.stopPrank();
    }

    // ───────────── daily window ─────────────

    function test_dailyWindow_resetsAtMidnightUtc() public {
        vm.warp(DAY0 + 1 days - 1); // 23:59:59
        for (uint256 i = 0; i < 4; i++) {
            _pay(news, PER_PAY);
        }
        assertEq(_rein().spentToday, DAILY);
        assertEq(uint8(_pay(news, 1 * U)), uint8(Rienda.Outcome.Held)); // cap reached same day

        vm.warp(DAY0 + 1 days); // 00:00:00 next day
        assertEq(uint8(_pay(news, PER_PAY)), uint8(Rienda.Outcome.Paid));
        assertEq(_rein().spentToday, PER_PAY); // reset, then this payment
        assertEq(_rein().day, uint64((DAY0 + 1 days) / 1 days));
    }

    function test_dailyWindow_notResetBeforeMidnight() public {
        vm.warp(DAY0 + 1 days - 2);
        for (uint256 i = 0; i < 4; i++) {
            _pay(news, PER_PAY);
        }
        vm.warp(DAY0 + 1 days - 1);
        assertEq(uint8(_pay(news, 1 * U)), uint8(Rienda.Outcome.Held));
    }

    function test_dailyWindow_blockedAttemptStillRollsDay() public {
        _pay(news, PER_PAY);
        vm.warp(DAY0 + 1 days + 5);
        _pay(attacker, 1 * U);
        assertEq(_rein().spentToday, 0);
    }

    // ───────────── approve / deny ─────────────

    function test_approve_paysMerchant_notCountedInSpentToday() public {
        _pay(gpu, 12 * U);
        assertEq(_rein().spentToday, 0);

        vm.expectEmit(true, false, false, false);
        emit Approved(0);
        vm.prank(owner);
        rienda.approve(0);

        assertEq(usdc.balanceOf(gpu), 12 * U);
        assertEq(_rein().balance, DEPOSIT - 12 * U);
        assertEq(_rein().spentToday, 0);
        assertEq(_rein().openHeld, 0);
        (,,,, Rienda.ReqStatus st) = rienda.requests(0);
        assertEq(uint8(st), uint8(Rienda.ReqStatus.Approved));
    }

    function test_approve_secondApprove_reverts() public {
        _pay(gpu, 12 * U);
        vm.startPrank(owner);
        rienda.approve(0);
        vm.expectRevert(Rienda.RequestNotPending.selector);
        rienda.approve(0);
        vm.stopPrank();
    }

    function test_approve_worksWhenFrozen() public {
        _pay(gpu, 12 * U);
        for (uint256 i = 0; i < 3; i++) {
            _pay(attacker, 1 * U);
        }
        assertEq(uint8(_rein().status), uint8(Rienda.Status.Frozen));

        vm.prank(owner);
        rienda.approve(0);
        assertEq(usdc.balanceOf(gpu), 12 * U);
    }

    function test_approve_revert_notOwner() public {
        _pay(gpu, 12 * U);
        vm.prank(agent);
        vm.expectRevert(Rienda.NotOwner.selector);
        rienda.approve(0);
        vm.prank(stranger);
        vm.expectRevert(Rienda.NotOwner.selector);
        rienda.approve(0);
    }

    function test_approve_revert_unknownRequest() public {
        vm.prank(owner);
        vm.expectRevert(Rienda.RequestNotPending.selector);
        rienda.approve(42);
    }

    function test_deny_noMoneyMoves() public {
        _pay(gpu, 12 * U);
        vm.expectEmit(true, false, false, false);
        emit Denied(0);
        vm.prank(owner);
        rienda.deny(0);

        assertEq(usdc.balanceOf(gpu), 0);
        assertEq(_rein().balance, DEPOSIT);
        assertEq(_rein().strikes, 0);
        assertEq(_rein().openHeld, 0);
        (,,,, Rienda.ReqStatus st) = rienda.requests(0);
        assertEq(uint8(st), uint8(Rienda.ReqStatus.Denied));

        vm.prank(owner);
        vm.expectRevert(Rienda.RequestNotPending.selector);
        rienda.deny(0);
        vm.prank(owner);
        vm.expectRevert(Rienda.RequestNotPending.selector);
        rienda.approve(0);
    }

    function test_deny_revert_notOwner() public {
        _pay(gpu, 12 * U);
        vm.prank(agent);
        vm.expectRevert(Rienda.NotOwner.selector);
        rienda.deny(0);
    }

    function test_deny_freesHeldSlot() public {
        for (uint256 i = 0; i < 5; i++) {
            _pay(news, 6 * U);
        }
        vm.prank(owner);
        rienda.deny(0);
        assertEq(uint8(_pay(news, 6 * U)), uint8(Rienda.Outcome.Held));
    }

    // ───────────── owner-only functions ─────────────

    function test_ownerOnly_revertForNonOwner() public {
        Rienda.ReinParams memory p = _params();
        address[] memory callers = new address[](2);
        callers[0] = agent;
        callers[1] = stranger;
        for (uint256 i = 0; i < callers.length; i++) {
            vm.startPrank(callers[i]);
            vm.expectRevert(Rienda.NotOwner.selector);
            rienda.deposit(reinId, 1);
            vm.expectRevert(Rienda.NotOwner.selector);
            rienda.withdraw(reinId, 1);
            vm.expectRevert(Rienda.NotOwner.selector);
            rienda.setMerchant(reinId, attacker, true, "x");
            vm.expectRevert(Rienda.NotOwner.selector);
            rienda.setLimits(reinId, p);
            vm.expectRevert(Rienda.NotOwner.selector);
            rienda.freeze(reinId);
            vm.expectRevert(Rienda.NotOwner.selector);
            rienda.unfreeze(reinId);
            vm.expectRevert(Rienda.NotOwner.selector);
            rienda.close(reinId);
            vm.stopPrank();
        }
    }

    function test_ownerOnly_unknownRein() public {
        vm.prank(owner);
        vm.expectRevert(Rienda.ReinNotFound.selector);
        rienda.withdraw(999, 1);
    }

    // ───────────── deposit / withdraw / merchants / limits / close ─────────────

    function test_deposit() public {
        vm.expectEmit(true, false, false, true);
        emit Deposited(reinId, 10 * U);
        vm.prank(owner);
        rienda.deposit(reinId, 10 * U);
        assertEq(_rein().balance, DEPOSIT + 10 * U);
        assertEq(usdc.balanceOf(address(rienda)), DEPOSIT + 10 * U);
    }

    function test_deposit_revert_zero() public {
        vm.prank(owner);
        vm.expectRevert(Rienda.ZeroAmount.selector);
        rienda.deposit(reinId, 0);
    }

    function test_deposit_revert_closed() public {
        vm.startPrank(owner);
        rienda.close(reinId);
        vm.expectRevert(Rienda.ReinClosed.selector);
        rienda.deposit(reinId, 1);
        vm.stopPrank();
    }

    function test_withdraw_sendsToOwner() public {
        uint256 before = usdc.balanceOf(owner);
        vm.expectEmit(true, false, false, true);
        emit Withdrawn(reinId, 10 * U);
        vm.prank(owner);
        rienda.withdraw(reinId, 10 * U);
        assertEq(usdc.balanceOf(owner), before + 10 * U);
        assertEq(_rein().balance, DEPOSIT - 10 * U);
    }

    function test_withdraw_worksWhenFrozen() public {
        for (uint256 i = 0; i < 3; i++) {
            _pay(attacker, 1 * U);
        }
        assertEq(uint8(_rein().status), uint8(Rienda.Status.Frozen));
        vm.prank(owner);
        rienda.withdraw(reinId, DEPOSIT);
        assertEq(_rein().balance, 0);
    }

    function test_withdraw_revert_zero_andTooMuch() public {
        vm.startPrank(owner);
        vm.expectRevert(Rienda.ZeroAmount.selector);
        rienda.withdraw(reinId, 0);
        vm.expectRevert(Rienda.InsufficientBalance.selector);
        rienda.withdraw(reinId, DEPOSIT + 1);
        vm.stopPrank();
    }

    function test_reins_areIsolated() public {
        uint256 other = _create(7 * U);
        vm.prank(owner);
        vm.expectRevert(Rienda.InsufficientBalance.selector);
        rienda.withdraw(other, 8 * U);
        assertEq(rienda.getRein(other).balance, 7 * U);
        assertEq(_rein().balance, DEPOSIT);
    }

    function test_setMerchant_addRemove() public {
        vm.expectEmit(true, true, false, true);
        emit MerchantSet(reinId, stranger, true, "Coffee");
        vm.prank(owner);
        rienda.setMerchant(reinId, stranger, true, "Coffee");
        assertEq(uint8(_pay(stranger, 1 * U)), uint8(Rienda.Outcome.Paid));

        vm.prank(owner);
        rienda.setMerchant(reinId, stranger, false, "Coffee");
        assertEq(uint8(_pay(stranger, 1 * U)), uint8(Rienda.Outcome.Blocked));
    }

    function test_setMerchant_reverts() public {
        vm.startPrank(owner);
        vm.expectRevert(Rienda.ZeroAddress.selector);
        rienda.setMerchant(reinId, address(0), true, "");
        rienda.close(reinId);
        vm.expectRevert(Rienda.ReinClosed.selector);
        rienda.setMerchant(reinId, stranger, true, "");
        vm.stopPrank();
    }

    function test_setLimits_updatesAndValidates() public {
        Rienda.ReinParams memory p = _params();
        p.perPayCap = 8 * U;
        p.dailyCap = 40 * U;
        p.maxStrikes = 5;

        vm.expectEmit(true, false, false, true);
        emit LimitsSet(reinId, p.perPayCap, p.dailyCap, p.holdCeiling, p.expiry, p.maxStrikes);
        vm.prank(owner);
        rienda.setLimits(reinId, p);
        assertEq(_rein().perPayCap, 8 * U);
        assertEq(_rein().dailyCap, 40 * U);
        assertEq(_rein().maxStrikes, 5);
        assertEq(uint8(_pay(news, 8 * U)), uint8(Rienda.Outcome.Paid));

        p.perPayCap = 0;
        vm.prank(owner);
        vm.expectRevert(Rienda.InvalidLimits.selector);
        rienda.setLimits(reinId, p);
    }

    function test_setLimits_revert_closed() public {
        vm.startPrank(owner);
        rienda.close(reinId);
        vm.expectRevert(Rienda.ReinClosed.selector);
        rienda.setLimits(reinId, _params());
        vm.stopPrank();
    }

    function test_close_withdrawsAllAndLocks() public {
        uint256 before = usdc.balanceOf(owner);
        vm.expectEmit(true, false, false, false);
        emit Closed(reinId);
        vm.prank(owner);
        rienda.close(reinId);

        assertEq(usdc.balanceOf(owner), before + DEPOSIT);
        assertEq(_rein().balance, 0);
        assertEq(uint8(_rein().status), uint8(Rienda.Status.Closed));

        vm.startPrank(owner);
        vm.expectRevert(Rienda.ReinClosed.selector);
        rienda.close(reinId);
        vm.stopPrank();
    }

    function test_close_emptyRein_ok() public {
        uint256 id = _create(0);
        vm.prank(owner);
        rienda.close(id);
        assertEq(uint8(rienda.getRein(id).status), uint8(Rienda.Status.Closed));
    }

    // ───────────── edge cases E2–E10 ─────────────

    function test_E2_payToAgentOwnerOrContract_blocked() public {
        assertEq(uint8(_pay(agent, 1 * U)), uint8(Rienda.Outcome.Blocked));
        assertEq(uint8(_pay(owner, 1 * U)), uint8(Rienda.Outcome.Blocked));
        assertEq(_rein().strikes, 2);
        // third attempt (to the contract) freezes
        assertEq(uint8(_pay(address(rienda), 1 * U)), uint8(Rienda.Outcome.Blocked));
        assertEq(usdc.balanceOf(agent), 0);
    }

    function test_E3_spamFreezesAfterMaxStrikes() public {
        for (uint256 i = 0; i < 3; i++) {
            _pay(attacker, 1 * U);
        }
        vm.prank(agent);
        vm.expectRevert(Rienda.ReinFrozen.selector);
        rienda.pay(reinId, attacker, 1 * U, "");
    }

    function test_E4_floodHeld_sixthBlocked() public {
        for (uint256 i = 0; i < 5; i++) {
            _pay(news, 6 * U);
        }
        assertEq(uint8(_pay(news, 6 * U)), uint8(Rienda.Outcome.Blocked));
        assertEq(rienda.nextRequestId(), 5);
    }

    function test_E5_dayBoundary_separateCaps() public {
        vm.prank(owner);
        rienda.deposit(reinId, 20 * U); // 50 total: enough for two full days of spending
        vm.warp(DAY0 + 1 days - 1);
        for (uint256 i = 0; i < 4; i++) {
            _pay(news, PER_PAY);
        }
        vm.warp(DAY0 + 1 days + 1);
        for (uint256 i = 0; i < 4; i++) {
            assertEq(uint8(_pay(news, PER_PAY)), uint8(Rienda.Outcome.Paid));
        }
        assertEq(usdc.balanceOf(news), 8 * PER_PAY);
    }

    function test_E6_sameBlockTwoPayments_secondHeld() public {
        // raise per-pay so two payments can pass individually but not together
        Rienda.ReinParams memory p = _params();
        p.perPayCap = 15 * U;
        vm.prank(owner);
        rienda.setLimits(reinId, p);

        assertEq(uint8(_pay(news, 12 * U)), uint8(Rienda.Outcome.Paid));
        assertEq(uint8(_pay(news, 12 * U)), uint8(Rienda.Outcome.Held)); // 24 > 20
    }

    function test_E7_balanceLow_noFundsNoStrike() public {
        vm.prank(owner);
        rienda.withdraw(reinId, DEPOSIT - 1 * U);
        assertEq(uint8(_pay(news, 2 * U)), uint8(Rienda.Outcome.Blocked));
        assertEq(_rein().strikes, 0);
    }

    function test_E8_approveInsufficientBalance_staysPending() public {
        _pay(gpu, 12 * U);
        vm.startPrank(owner);
        rienda.withdraw(reinId, DEPOSIT - 5 * U);
        vm.expectRevert(Rienda.InsufficientBalance.selector);
        rienda.approve(0);
        vm.stopPrank();
        (,,,, Rienda.ReqStatus st) = rienda.requests(0);
        assertEq(uint8(st), uint8(Rienda.ReqStatus.Pending));

        // after topping up it can be approved
        vm.startPrank(owner);
        rienda.deposit(reinId, 10 * U);
        rienda.approve(0);
        vm.stopPrank();
        assertEq(usdc.balanceOf(gpu), 12 * U);
    }

    function test_E9_merchantRemovedWhilePending_ownerCanStillApproveOrDeny() public {
        _pay(gpu, 12 * U);
        _pay(gpu, 13 * U);
        vm.startPrank(owner);
        rienda.setMerchant(reinId, gpu, false, "GPU minutes");
        rienda.approve(0);
        rienda.deny(1);
        vm.stopPrank();
        assertEq(usdc.balanceOf(gpu), 12 * U);
    }

    function test_E10_expiredWithPending_ownerCanStillApproveDenyWithdraw() public {
        _pay(gpu, 12 * U);
        _pay(gpu, 13 * U);
        vm.warp(_rein().expiry + 1);

        vm.prank(agent);
        vm.expectRevert(Rienda.ReinExpired.selector);
        rienda.pay(reinId, news, 1 * U, "");

        vm.startPrank(owner);
        rienda.approve(0);
        rienda.deny(1);
        rienda.withdraw(reinId, DEPOSIT - 12 * U);
        vm.stopPrank();
        assertEq(_rein().balance, 0);
    }

    // ───────────── security properties ─────────────

    function test_agentNeverReceivesUsdc() public {
        _pay(news, 2 * U);
        _pay(gpu, 12 * U);
        _pay(attacker, 5 * U);
        vm.startPrank(owner);
        rienda.approve(0);
        rienda.withdraw(reinId, 1 * U);
        vm.stopPrank();
        assertEq(usdc.balanceOf(agent), 0);
    }

    function test_memoNotStoredInStorage() public {
        // Request struct has no memo field; Held/Paid carry it in the event only
        _pay(gpu, 12 * U);
        (uint256 rid,,,,) = rienda.requests(0);
        assertEq(rid, reinId);
    }
}
