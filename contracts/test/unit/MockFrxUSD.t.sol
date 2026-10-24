// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MockFrxUSD} from "../../src/mocks/MockFrxUSD.sol";

contract MockFrxUSDTest is Test {
    MockFrxUSD internal token;

    function setUp() public {
        token = new MockFrxUSD();
    }

    function test_constructor_setsMetadata() public view {
        assertEq(token.name(), "Mock frxUSD");
        assertEq(token.symbol(), "frxUSD");
        assertEq(token.decimals(), 18);
    }

    function test_mint_openToAnyone() public {
        address anyone = makeAddr("anyone");
        vm.prank(anyone);
        token.mint(anyone, 5e18);
        assertEq(token.balanceOf(anyone), 5e18);
        assertEq(token.totalSupply(), 5e18);
    }
}
