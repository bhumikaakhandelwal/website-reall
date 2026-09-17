export const xpIntro =
  "XP is earned through meaningful participation, learning, competitions, and contribution. XP is verified by the faculty coordinators and student core committee.";

export type XpActivity = {
  activity: string;
  xp: number;
  starred?: boolean;
};

export const xpActivities: XpActivity[] = [
  { activity: "Membership", xp: 50 },
  { activity: "Attend technical session", xp: 50 },
  { activity: "Solving club coding problem", xp: 50 },
  { activity: "Publish GitHub project", xp: 50, starred: true },
  { activity: "Create technical tutorial", xp: 50 },
  { activity: "Open-source contribution", xp: 100, starred: true },
  { activity: "Support in organizing club events", xp: 100 },
  { activity: "Participate in internal coding contest", xp: 100 },
  { activity: "Top 10 — Internal contest", xp: 150 },
  { activity: "Participate in external coding contest/hackathon", xp: 150 },
  { activity: "Top 3 — Internal contest", xp: 200 },
  { activity: "Conduct workshop/sessions/events", xp: 200 },
  { activity: "Reach hackathon finals", xp: 200 },
  { activity: "Win hackathon", xp: 250 },
  { activity: "30-day coding streak", xp: 250, starred: true },
];

export const xpActivityFootnote =
  "GitHub projects submitted and open-source contributions should be meaningful to claim XP. The 30-day coding streak should be on LeetCode or HackerRank. XP points are subject to Committee and/or Advisor approval.";

export type XpLevel = {
  level: number;
  xpRequired: string;
  title: string;
};

export const xpLevels: XpLevel[] = [
  { level: 1, xpRequired: "< 500", title: "Rookie" },
  { level: 2, xpRequired: "500", title: "Novice Coder" },
  { level: 3, xpRequired: "1,000", title: "Code Explorer" },
  { level: 4, xpRequired: "2,000", title: "Code Warrior" },
  { level: 5, xpRequired: "3,000", title: "Coding Champion" },
  { level: 6, xpRequired: "4,000", title: "Code Master" },
  { level: 7, xpRequired: "5,000", title: "Coding Legend" },
];

export const leaderboardTypes = [
  {
    // Phase 4: the id links this display copy to the leaderboard data returned
    // by GET /api/leaderboard. Nothing else changed - the /xp-system page still
    // reads only title and description.
    id: "overall",
    title: "Overall XP Leaderboard",
    description: "Every member, ranked by total XP across all activity.",
  },
  {
    id: "hackathon",
    title: "Hackathon Leaderboard",
    description: "Ranked by hackathon performance — rounds reached and wins.",
  },
  {
    id: "open-source",
    title: "Contribution Leaderboard",
    description: "Ranked by open-source project contributions.",
  },
] as const;

export const leaderboardNote =
  "Leaderboards are updated monthly and displayed on the club's Discord and WhatsApp.";

export const rewards = ["Certificates", "Best Hackathon Team Award"] as const;

export type XpPenalty = {
  violation: string;
  penalty: number;
};

export const xpPenalties: XpPenalty[] = [
  { violation: "Fake certificate submission", penalty: -500 },
  { violation: "Plagiarism in internal/external competitions", penalty: -200 },
  { violation: "Unsportsmanlike conduct", penalty: -100 },
  { violation: "Verified non-contribution in team event", penalty: -50 },
  { violation: "Absence from club meetings/sessions without valid reason", penalty: -50 },
];