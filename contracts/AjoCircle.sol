// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// Rotating savings circles (ajo / esusu). Many circles live in one contract.
/// No admin, no owner. Funds only go out as the round's payout.
contract AjoCircle {
    struct Circle {
        address token;
        address creator;
        uint256 contribution;
        uint32 maxMembers;
        uint32 roundDuration;
        uint32 currentRound;
        uint64 roundStart;
        bool started;
        bool finished;
        address[] members;
    }

    uint32 public constant MAX_MEMBERS = 20;

    uint256 public circleCount;
    mapping(uint256 => Circle) private circles;
    mapping(uint256 => mapping(address => bool)) public isMember;
    mapping(uint256 => mapping(uint32 => mapping(address => bool))) public hasPaid;
    mapping(uint256 => mapping(uint32 => uint32)) public paidCount;

    event CircleCreated(uint256 indexed id, address indexed creator, address token, uint256 contribution, uint32 maxMembers, uint32 roundDuration);
    event MemberJoined(uint256 indexed id, address indexed member);
    event CircleStarted(uint256 indexed id, uint64 startTime);
    event Contributed(uint256 indexed id, uint32 indexed round, address indexed member, uint256 amount);
    event PayoutMade(uint256 indexed id, uint32 indexed round, address indexed recipient, uint256 amount);
    event MissedRound(uint256 indexed id, uint32 indexed round, address indexed member);
    event CircleFinished(uint256 indexed id);

    function createCircle(
        address token,
        uint256 contribution,
        uint32 maxMembers,
        uint32 roundDuration
    ) external returns (uint256 id) {
        require(token != address(0), "token");
        require(contribution > 0, "contribution");
        require(maxMembers >= 2 && maxMembers <= MAX_MEMBERS, "members");
        require(roundDuration > 0, "duration");

        id = ++circleCount;
        Circle storage c = circles[id];
        c.token = token;
        c.creator = msg.sender;
        c.contribution = contribution;
        c.maxMembers = maxMembers;
        c.roundDuration = roundDuration;
        c.members.push(msg.sender);
        isMember[id][msg.sender] = true;

        emit CircleCreated(id, msg.sender, token, contribution, maxMembers, roundDuration);
        emit MemberJoined(id, msg.sender);
    }

    function joinCircle(uint256 id) external {
        Circle storage c = circles[id];
        require(c.creator != address(0), "no circle");
        require(!c.started, "started");
        require(!isMember[id][msg.sender], "already member");
        require(c.members.length < c.maxMembers, "full");

        c.members.push(msg.sender);
        isMember[id][msg.sender] = true;
        emit MemberJoined(id, msg.sender);

        if (c.members.length == c.maxMembers) {
            c.started = true;
            c.roundStart = uint64(block.timestamp);
            emit CircleStarted(id, c.roundStart);
        }
    }

    /// Caller must have approved this contract to spend `contribution` of the token.
    function contribute(uint256 id) external {
        Circle storage c = circles[id];
        require(c.started && !c.finished, "not active");
        require(isMember[id][msg.sender], "not member");
        uint32 round = c.currentRound;
        require(!hasPaid[id][round][msg.sender], "already paid");

        hasPaid[id][round][msg.sender] = true;
        paidCount[id][round] += 1;

        require(IERC20(c.token).transferFrom(msg.sender, address(this), c.contribution), "transfer failed");
        emit Contributed(id, round, msg.sender, c.contribution);
    }

    /// Anyone can call. Pays the round's recipient once everyone has paid,
    /// or once the round time is up (pays what was collected, logs who missed).
    function payout(uint256 id) external {
        Circle storage c = circles[id];
        require(c.started && !c.finished, "not active");

        uint32 round = c.currentRound;
        uint32 paid = paidCount[id][round];
        uint256 n = c.members.length;
        require(paid > 0, "nothing collected");
        require(paid == n || block.timestamp >= uint256(c.roundStart) + c.roundDuration, "round open");

        if (paid < n) {
            for (uint256 i = 0; i < n; i++) {
                if (!hasPaid[id][round][c.members[i]]) {
                    emit MissedRound(id, round, c.members[i]);
                }
            }
        }

        address recipient = c.members[round];
        uint256 amount = c.contribution * paid;

        c.currentRound = round + 1;
        if (c.currentRound == n) {
            c.finished = true;
            emit CircleFinished(id);
        } else {
            c.roundStart = uint64(block.timestamp);
        }

        require(IERC20(c.token).transfer(recipient, amount), "payout failed");
        emit PayoutMade(id, round, recipient, amount);
    }

    function getCircle(uint256 id) external view returns (
        address token,
        address creator,
        uint256 contribution,
        uint32 maxMembers,
        uint32 roundDuration,
        uint32 currentRound,
        uint64 roundStart,
        bool started,
        bool finished,
        uint256 memberCount
    ) {
        Circle storage c = circles[id];
        return (c.token, c.creator, c.contribution, c.maxMembers, c.roundDuration,
                c.currentRound, c.roundStart, c.started, c.finished, c.members.length);
    }

    function getMembers(uint256 id) external view returns (address[] memory) {
        return circles[id].members;
    }
}