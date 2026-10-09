// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Rienda
/// @notice Onchain spending limits for AI agents. One shared contract; each "rein" binds an agent
///         wallet to caps, a merchant allowlist and a USDC balance held here.
/// @dev Policy violations never revert in `pay` (FR-8) so the attempt is recorded and strikes count.
///      Only FR-7 cases revert. USDC is only ever sent to allow-listed merchants (approve may pay a
///      merchant removed after the request was made, by owner's explicit decision) or back to the owner.
contract Rienda is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ───────────────────────────── Types ─────────────────────────────

    enum Status { None, Active, Frozen, Closed }
    enum Outcome { Paid, Held, Blocked }
    enum Reason { None, NOT_ALLOWED, ABOVE_CEILING, TOO_MANY_HELD, NO_FUNDS }
    enum ReqStatus { None, Pending, Approved, Denied }

    struct Rein {
        address owner;
        address agent;
        uint128 balance;
        uint128 perPayCap;
        uint128 dailyCap;
        uint128 holdCeiling;
        uint128 spentToday;
        uint64 day;
        uint64 expiry;
        uint8 strikes;
        uint8 maxStrikes;
        uint8 openHeld;
        Status status;
    }

    struct Request {
        uint256 reinId;
        address to;
        uint128 amount;
        uint64 createdAt;
        ReqStatus status;
    }

    /// @dev Grouped to avoid "stack too deep" in createRein / setLimits.
    struct ReinParams {
        address agent;
        uint128 perPayCap;
        uint128 dailyCap;
        uint128 holdCeiling;
        uint64 expiry;
        uint8 maxStrikes;
    }

    // ───────────────────────────── Constants / state ─────────────────────────────

    uint8 public constant MAX_OPEN_HELD = 5;
    uint8 public constant MAX_STRIKES_LIMIT = 10;
    uint256 public constant MAX_MEMO_BYTES = 140;

    IERC20 public immutable usdc;
    uint256 public nextReinId;
    uint256 public nextRequestId;

    mapping(uint256 => Rein) public reins;
    mapping(uint256 => mapping(address => bool)) public isMerchant;
    mapping(uint256 => Request) public requests;

    // ───────────────────────────── Events ─────────────────────────────

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
        uint256 indexed reinId, address indexed to, uint128 amount, Reason reason, uint8 strikes, string memo
    );
    event Frozen(uint256 indexed reinId, bool auto_);
    event Unfrozen(uint256 indexed reinId);
    event Approved(uint256 indexed requestId);
    event Denied(uint256 indexed requestId);
    event Closed(uint256 indexed reinId);

    // ───────────────────────────── Errors ─────────────────────────────

    error ZeroAddress();
    error InvalidLimits();
    error InvalidExpiry();
    error InvalidMaxStrikes();
    error AgentIsOwner();
    error LengthMismatch();
    error ZeroAmount();
    error ReinNotFound();
    error NotOwner();
    error NotAgent();
    error ReinFrozen();
    error ReinNotActive();
    error ReinClosed();
    error ReinExpired();
    error AlreadyFrozen();
    error NotFrozen();
    error MemoTooLong();
    error InsufficientBalance();
    error RequestNotPending();

    // ───────────────────────────── Setup ─────────────────────────────

    constructor(address usdc_) {
        if (usdc_ == address(0)) revert ZeroAddress();
        usdc = IERC20(usdc_);
    }

    // ───────────────────────────── Modifiers ─────────────────────────────

    modifier onlyOwner(uint256 reinId) {
        Rein storage r = reins[reinId];
        if (r.status == Status.None) revert ReinNotFound();
        if (msg.sender != r.owner) revert NotOwner();
        _;
    }

    // ───────────────────────────── Owner: lifecycle ─────────────────────────────

    /// @notice Create a rein. Caller becomes owner. Pulls `deposit` USDC (needs prior approval).
    function createRein(
        ReinParams calldata p,
        address[] calldata merchants,
        string[] calldata labels,
        uint128 deposit_
    ) external nonReentrant returns (uint256 reinId) {
        if (p.agent == address(0)) revert ZeroAddress();
        if (p.agent == msg.sender) revert AgentIsOwner();
        _validateLimits(p.perPayCap, p.dailyCap, p.holdCeiling, p.expiry, p.maxStrikes);
        if (merchants.length != labels.length) revert LengthMismatch();

        reinId = nextReinId++;
        Rein storage r = reins[reinId];
        r.owner = msg.sender;
        r.agent = p.agent;
        r.perPayCap = p.perPayCap;
        r.dailyCap = p.dailyCap;
        r.holdCeiling = p.holdCeiling;
        r.expiry = p.expiry;
        r.maxStrikes = p.maxStrikes;
        r.day = uint64(block.timestamp / 1 days);
        r.status = Status.Active;

        emit ReinCreated(reinId, msg.sender, p.agent);
        emit LimitsSet(reinId, p.perPayCap, p.dailyCap, p.holdCeiling, p.expiry, p.maxStrikes);

        for (uint256 i = 0; i < merchants.length; i++) {
            if (merchants[i] == address(0)) revert ZeroAddress();
            isMerchant[reinId][merchants[i]] = true;
            emit MerchantSet(reinId, merchants[i], true, labels[i]);
        }

        if (deposit_ > 0) {
            r.balance = deposit_;
            usdc.safeTransferFrom(msg.sender, address(this), deposit_);
            emit Deposited(reinId, deposit_);
        }
    }

    function deposit(uint256 reinId, uint128 amount) external nonReentrant onlyOwner(reinId) {
        Rein storage r = reins[reinId];
        if (r.status == Status.Closed) revert ReinClosed();
        if (amount == 0) revert ZeroAmount();
        r.balance += amount;
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(reinId, amount);
    }

    /// @notice Withdraw to the owner. Works in any status (including Frozen and Closed).
    function withdraw(uint256 reinId, uint128 amount) external nonReentrant onlyOwner(reinId) {
        if (amount == 0) revert ZeroAmount();
        Rein storage r = reins[reinId];
        if (amount > r.balance) revert InsufficientBalance();
        r.balance -= amount;
        usdc.safeTransfer(r.owner, amount);
        emit Withdrawn(reinId, amount);
    }

    function setMerchant(uint256 reinId, address merchant, bool allowed, string calldata label)
        external
        onlyOwner(reinId)
    {
        if (reins[reinId].status == Status.Closed) revert ReinClosed();
        if (merchant == address(0)) revert ZeroAddress();
        isMerchant[reinId][merchant] = allowed;
        emit MerchantSet(reinId, merchant, allowed, label);
    }

    function setLimits(uint256 reinId, ReinParams calldata p) external onlyOwner(reinId) {
        Rein storage r = reins[reinId];
        if (r.status == Status.Closed) revert ReinClosed();
        _validateLimits(p.perPayCap, p.dailyCap, p.holdCeiling, p.expiry, p.maxStrikes);
        r.perPayCap = p.perPayCap;
        r.dailyCap = p.dailyCap;
        r.holdCeiling = p.holdCeiling;
        r.expiry = p.expiry;
        r.maxStrikes = p.maxStrikes;
        emit LimitsSet(reinId, p.perPayCap, p.dailyCap, p.holdCeiling, p.expiry, p.maxStrikes);
    }

    function freeze(uint256 reinId) external onlyOwner(reinId) {
        Rein storage r = reins[reinId];
        if (r.status != Status.Active) {
            if (r.status == Status.Closed) revert ReinClosed();
            revert AlreadyFrozen();
        }
        r.status = Status.Frozen;
        emit Frozen(reinId, false);
    }

    /// @notice Back to Active with strikes reset to 0.
    function unfreeze(uint256 reinId) external onlyOwner(reinId) {
        Rein storage r = reins[reinId];
        if (r.status != Status.Frozen) {
            if (r.status == Status.Closed) revert ReinClosed();
            revert NotFrozen();
        }
        r.status = Status.Active;
        r.strikes = 0;
        emit Unfrozen(reinId);
    }

    /// @notice Withdraw everything to the owner and close permanently.
    function close(uint256 reinId) external nonReentrant onlyOwner(reinId) {
        Rein storage r = reins[reinId];
        if (r.status == Status.Closed) revert ReinClosed();
        uint128 amount = r.balance;
        r.balance = 0;
        r.status = Status.Closed;
        emit Closed(reinId);
        if (amount > 0) {
            usdc.safeTransfer(r.owner, amount);
            emit Withdrawn(reinId, amount);
        }
    }

    // ───────────────────────────── Agent: pay ─────────────────────────────

    /// @notice Agent payment. Reverts only for FR-7 cases; every other result is an event + outcome.
    function pay(uint256 reinId, address to, uint128 amount, string calldata memo)
        external
        nonReentrant
        returns (Outcome)
    {
        Rein storage r = reins[reinId];
        if (r.status == Status.None) revert ReinNotFound();
        if (msg.sender != r.agent) revert NotAgent();
        if (r.status == Status.Frozen) revert ReinFrozen();
        if (r.status != Status.Active) revert ReinNotActive();
        if (block.timestamp >= r.expiry) revert ReinExpired();
        if (amount == 0) revert ZeroAmount();
        if (bytes(memo).length > MAX_MEMO_BYTES) revert MemoTooLong();

        // FR-10: calendar-day window (UTC)
        uint64 today = uint64(block.timestamp / 1 days);
        if (r.day != today) {
            r.day = today;
            r.spentToday = 0;
        }

        // 1. recipient allowlist
        if (!isMerchant[reinId][to]) return _block(reinId, r, to, amount, Reason.NOT_ALLOWED, true, memo);
        // 2. hold ceiling
        if (amount > r.holdCeiling) return _block(reinId, r, to, amount, Reason.ABOVE_CEILING, true, memo);
        // 3. too many open held requests
        if (r.openHeld >= MAX_OPEN_HELD) return _block(reinId, r, to, amount, Reason.TOO_MANY_HELD, true, memo);

        // 4. hold for owner approval
        if (amount > r.perPayCap || uint256(r.spentToday) + amount > r.dailyCap) {
            uint256 requestId = nextRequestId++;
            requests[requestId] = Request({
                reinId: reinId,
                to: to,
                amount: amount,
                createdAt: uint64(block.timestamp),
                status: ReqStatus.Pending
            });
            r.openHeld++;
            emit Held(reinId, requestId, to, amount, memo);
            return Outcome.Held;
        }

        // 5. funds (no strike)
        if (amount > r.balance) return _block(reinId, r, to, amount, Reason.NO_FUNDS, false, memo);

        // 6. pay (effects before interaction)
        r.spentToday += amount;
        r.balance -= amount;
        usdc.safeTransfer(to, amount);
        emit Paid(reinId, to, amount, memo);
        return Outcome.Paid;
    }

    // ───────────────────────────── Owner: held requests ─────────────────────────────

    /// @notice Pay a held request. Not counted in spentToday. Works while Frozen/expired.
    function approve(uint256 requestId) external nonReentrant {
        Request storage q = requests[requestId];
        if (q.status != ReqStatus.Pending) revert RequestNotPending();
        Rein storage r = reins[q.reinId];
        if (msg.sender != r.owner) revert NotOwner();
        if (q.amount > r.balance) revert InsufficientBalance();

        q.status = ReqStatus.Approved;
        r.openHeld--;
        r.balance -= q.amount;
        emit Approved(requestId);
        usdc.safeTransfer(q.to, q.amount);
    }

    function deny(uint256 requestId) external {
        Request storage q = requests[requestId];
        if (q.status != ReqStatus.Pending) revert RequestNotPending();
        Rein storage r = reins[q.reinId];
        if (msg.sender != r.owner) revert NotOwner();
        q.status = ReqStatus.Denied;
        r.openHeld--;
        emit Denied(requestId);
    }

    // ───────────────────────────── Views ─────────────────────────────

    function getRein(uint256 reinId) external view returns (Rein memory) {
        return reins[reinId];
    }

    // ───────────────────────────── Internal ─────────────────────────────

    function _block(
        uint256 reinId,
        Rein storage r,
        address to,
        uint128 amount,
        Reason reason,
        bool strike,
        string calldata memo
    ) internal returns (Outcome) {
        if (strike) r.strikes++;
        emit Blocked(reinId, to, amount, reason, r.strikes, memo);
        if (strike && r.strikes >= r.maxStrikes) {
            r.status = Status.Frozen;
            emit Frozen(reinId, true);
        }
        return Outcome.Blocked;
    }

    function _validateLimits(
        uint128 perPayCap,
        uint128 dailyCap,
        uint128 holdCeiling,
        uint64 expiry,
        uint8 maxStrikes
    ) internal view {
        if (perPayCap == 0 || perPayCap > dailyCap || perPayCap > holdCeiling) revert InvalidLimits();
        if (expiry <= block.timestamp) revert InvalidExpiry();
        if (maxStrikes == 0 || maxStrikes > MAX_STRIKES_LIMIT) revert InvalidMaxStrikes();
    }
}
