// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Rienda} from "../src/Rienda.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";

contract Handler is Test {
    Rienda public rienda;
    MockUSDC public usdc;
    address public owner;
    address public agent;
    address[] public targets; // merchants + attackers
    uint256 public constant REINS = 3;
    uint256 public payAttemptsOnFrozen;
    uint256 public frozenPaid; // pay() calls that succeeded while Frozen (must stay 0)

    constructor(Rienda r, MockUSDC u, address o, address a, address[] memory t) {
        rienda = r;
        usdc = u;
        owner = o;
        agent = a;
        targets = t;
    }

    function pay(uint256 reinSeed, uint256 toSeed, uint128 amount) external {
        uint256 id = reinSeed % REINS;
        address to = targets[toSeed % targets.length];
        amount = uint128(bound(amount, 1, 60e6));
        Rienda.Status before_ = rienda.getRein(id).status;
        vm.prank(agent);
        try rienda.pay(id, to, amount, "") {
            if (before_ == Rienda.Status.Frozen) frozenPaid++;
        } catch {
            if (before_ == Rienda.Status.Frozen) payAttemptsOnFrozen++;
        }
    }

    function approve(uint256 reqSeed) external {
        uint256 n = rienda.nextRequestId();
        if (n == 0) return;
        vm.prank(owner);
        try rienda.approve(reqSeed % n) {} catch {}
    }

    function deny(uint256 reqSeed) external {
        uint256 n = rienda.nextRequestId();
        if (n == 0) return;
        vm.prank(owner);
        try rienda.deny(reqSeed % n) {} catch {}
    }

    function deposit(uint256 reinSeed, uint128 amount) external {
        amount = uint128(bound(amount, 1, 50e6));
        vm.prank(owner);
        try rienda.deposit(reinSeed % REINS, amount) {} catch {}
    }

    function withdraw(uint256 reinSeed, uint128 amount) external {
        amount = uint128(bound(amount, 1, 50e6));
        vm.prank(owner);
        try rienda.withdraw(reinSeed % REINS, amount) {} catch {}
    }

    function freeze(uint256 reinSeed) external {
        vm.prank(owner);
        try rienda.freeze(reinSeed % REINS) {} catch {}
    }

    function unfreeze(uint256 reinSeed) external {
        vm.prank(owner);
        try rienda.unfreeze(reinSeed % REINS) {} catch {}
    }

    function warp(uint32 secs) external {
        vm.warp(block.timestamp + (uint256(secs) % 3 days));
    }
}

contract InvariantTest is Test {
    Rienda internal rienda;
    MockUSDC internal usdc;
    Handler internal handler;

    address internal owner = makeAddr("owner");
    address internal agent = makeAddr("agent");
    address[] internal targets;

    function setUp() public {
        vm.warp(20_000 days);
        usdc = new MockUSDC();
        rienda = new Rienda(address(usdc));
        usdc.mint(owner, 1_000_000e6);
        vm.prank(owner);
        usdc.approve(address(rienda), type(uint256).max);

        address m1 = makeAddr("m1");
        address m2 = makeAddr("m2");
        targets.push(m1);
        targets.push(m2);
        targets.push(makeAddr("attacker"));
        targets.push(agent); // agent paying itself must be blocked
        targets.push(owner);

        address[] memory m = new address[](2);
        string[] memory l = new string[](2);
        m[0] = m1;
        m[1] = m2;
        l[0] = "a";
        l[1] = "b";
        for (uint256 i = 0; i < 3; i++) {
            Rienda.ReinParams memory p = Rienda.ReinParams({
                agent: agent,
                perPayCap: 5e6,
                dailyCap: 20e6,
                holdCeiling: 50e6,
                expiry: uint64(block.timestamp + 3650 days),
                maxStrikes: uint8(2 + i)
            });
            vm.prank(owner);
            rienda.createRein(p, m, l, 30e6);
        }

        handler = new Handler(rienda, usdc, owner, agent, targets);
        targetContract(address(handler));
    }

    // (a) sum of all rein balances == USDC balance held by the contract
    function invariant_balancesSumToContractBalance() public view {
        uint256 sum;
        for (uint256 i = 0; i < 3; i++) {
            sum += rienda.getRein(i).balance;
        }
        // held-then-approved payments leave the contract and decrement balance, so equality is exact
        assertEq(sum, usdc.balanceOf(address(rienda)));
    }

    // (b) spentToday never exceeds dailyCap
    function invariant_spentTodayWithinDailyCap() public view {
        for (uint256 i = 0; i < 3; i++) {
            Rienda.Rein memory r = rienda.getRein(i);
            assertLe(r.spentToday, r.dailyCap);
        }
    }

    // (c) a Frozen rein never pays through pay()
    function invariant_frozenNeverPays() public view {
        assertEq(handler.frozenPaid(), 0);
    }

    // (d) the agent never receives USDC
    function invariant_agentNeverReceivesUsdc() public view {
        assertEq(usdc.balanceOf(agent), 0);
    }

    // open held count always matches pending requests and stays ≤ 5
    function invariant_openHeldConsistent() public view {
        uint256[3] memory pending;
        uint256 n = rienda.nextRequestId();
        for (uint256 i = 0; i < n; i++) {
            (uint256 rid,,,, Rienda.ReqStatus st) = rienda.requests(i);
            if (st == Rienda.ReqStatus.Pending) pending[rid]++;
        }
        for (uint256 i = 0; i < 3; i++) {
            assertEq(rienda.getRein(i).openHeld, pending[i]);
            assertLe(rienda.getRein(i).openHeld, 5);
        }
    }
}
