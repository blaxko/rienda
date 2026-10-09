// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {Rienda} from "../src/Rienda.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";

/// @notice Measures pay() gas per outcome. Run: forge test --match-contract GasMeasure -vv
contract GasMeasure is Test {
    Rienda r;
    MockUSDC usdc;
    address owner = makeAddr("owner");
    address agent = makeAddr("agent");
    address m = makeAddr("m");
    address bad = makeAddr("bad");

    function setUp() public {
        vm.warp(20_000 days + 12 hours);
        usdc = new MockUSDC();
        r = new Rienda(address(usdc));
        usdc.mint(owner, 1_000e6);
        vm.startPrank(owner);
        usdc.approve(address(r), type(uint256).max);
        address[] memory ms = new address[](1);
        string[] memory ls = new string[](1);
        ms[0] = m;
        ls[0] = "m";
        r.createRein(
            Rienda.ReinParams(agent, 5e6, 20e6, 50e6, uint64(block.timestamp + 7 days), 3), ms, ls, 500e6
        );
        vm.stopPrank();
        // warm-up the merchant's USDC slot is NOT done: first payment to a fresh address is the worst case
    }

    function _gas(address to, uint128 amt) internal returns (uint256 g) {
        vm.prank(agent);
        uint256 b = gasleft();
        r.pay(0, to, amt, "News: Oct 12 market brief");
        g = b - gasleft();
    }

    function test_measure() public {
        uint256 held = _gas(m, 12e6);
        uint256 paidFresh = _gas(m, 2e6);
        uint256 paidRepeat = _gas(m, 2e6);
        uint256 blocked1 = _gas(bad, 1e6);
        uint256 blocked2 = _gas(bad, 1e6);
        uint256 blockedFrozen = _gas(bad, 1e6);
        console2.log("Held            ", held);
        console2.log("Paid (fresh to) ", paidFresh);
        console2.log("Paid (repeat)   ", paidRepeat);
        console2.log("Blocked (1st)   ", blocked1);
        console2.log("Blocked (2nd)   ", blocked2);
        console2.log("Blocked+Frozen  ", blockedFrozen);
    }
}
