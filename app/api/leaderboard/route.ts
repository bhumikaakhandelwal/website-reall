import { NextResponse } from "next/server";
import { getMonthlyLeaderboard } from "@/lib/db/queries";
import {
  LEADERBOARDS,
  assignRanks,
  istMonthPeriod,
} from "@/lib/xp/leaderboards";

/*
 * ==========================================
 * INAUGURATION MODE
 * ==========================================
 *
 * true  = leaderboard can be viewed without login
 * false = leaderboard requires login again
 */
const INAUGURATION_MODE = true;

export async function GET() {
  try {
    /*
     * ==========================================
     * AUTHENTICATION
     * ==========================================
     *
     * During inauguration we intentionally skip
     * the member authentication check.
     *
     * After inauguration, change:
     *
     *     INAUGURATION_MODE = false
     *
     * and restore the requireMember() check.
     */
    if (!INAUGURATION_MODE) {
      const { requireMember } = await import(
        "@/lib/auth/require-manager"
      );

      const auth = await requireMember();

      if (!auth.ok) {
        return auth.response;
      }
    }

    /*
     * ==========================================
     * CURRENT MONTH
     * ==========================================
     */

    const period = istMonthPeriod();

    /*
     * ==========================================
     * LOAD ALL LEADERBOARDS
     * ==========================================
     */

    const results = await Promise.all(
      LEADERBOARDS.map((board) =>
        getMonthlyLeaderboard(
          period,
          board.activityCodes
        )
      )
    );

    /*
     * Database error
     */
    if (results.some((rows) => rows === null)) {
      console.error(
        "Error in GET /api/leaderboard: leaderboard aggregation unavailable"
      );

      return NextResponse.json(
        {
          error: "Internal server error",
        },
        {
          status: 500,
        }
      );
    }

    /*
     * ==========================================
     * RETURN LEADERBOARD
     * ==========================================
     */

    return NextResponse.json({
      period: {
        start: period.start.toISOString(),
        end: period.end.toISOString(),
      },

      boards: LEADERBOARDS.map(
        (board, index) => ({
          id: board.id,

          entries: assignRanks(
            results[index] ?? []
          ),
        })
      ),
    });
  } catch (error) {
    console.error(
      "Error in GET /api/leaderboard:",
      error
    );

    return NextResponse.json(
      {
        error: "Internal server error",
      },
      {
        status: 500,
      }
    );
  }
}