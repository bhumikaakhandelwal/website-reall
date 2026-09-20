import Link from "next/link";

// Phase 9: the homepage challenge cards.
//
// The card markup is UNCHANGED from the placeholder version - same section, same
// grid, same typography, same hover. What changed is the data and the call to
// action: the cards now come from the `challenges` table and each one links to
// its own page.
//
// The 150 / 400 / 900 XP placeholders are gone. Every amount shown here is the
// Handbook value for the challenge's activity, read from the database.

export type HomeChallenge = {
  slug: string;
  title: string;
  xpReward: number;
  difficulty: string;
  description: string;
};

const DIFFICULTY_LABELS: Record<string, string> = {
  beginner: "BEGINNER",
  intermediate: "INTERMEDIATE",
  advanced: "ADVANCED",
};

export function OpenChallenges({
  challenges,
}: {
  challenges: readonly HomeChallenge[];
}) {
  // Nothing to show is a real state - every challenge could be archived, or the
  // read could have failed. The section is omitted rather than rendered empty,
  // because an empty "Open challenges" heading reads as a bug.
  if (challenges.length === 0) return null;

  return (
    <section className="px-page pt-4 pb-20">
      <div className="mx-auto max-w-content">

        {/* Heading */}
        <div className="mb-16 flex items-end justify-between border-t border-border pt-8">
          <div>
            <p className="label-eyebrow mb-6 text-accent">
              Weekly drops
            </p>

            <h2 className="text-5xl font-bold tracking-tight md:text-7xl">
              Open <span className="text-accent">challenges.</span>
            </h2>
          </div>

          
        </div>

        {/* Cards */}
        <div className="grid gap-6 md:grid-cols-3">
          {challenges.map((challenge) => (
            <article
              key={challenge.slug}
              className="group flex min-h-[330px] flex-col justify-between border border-border bg-background p-8 transition-all duration-300 hover:-translate-y-1 hover:border-foreground"
            >
              <div>
                <div className="mb-16 flex items-center justify-between">
                  <span className="label-eyebrow text-muted">
                    {DIFFICULTY_LABELS[challenge.difficulty] ?? challenge.difficulty}
                  </span>

                  <span className="label-eyebrow text-accent">
                    {challenge.xpReward} XP
                  </span>
                </div>

                <h3 className="mb-5 text-2xl font-bold md:text-3xl">
                  {challenge.title}
                </h3>

                <p className="max-w-sm text-base leading-7 text-muted">
                  {challenge.description}
                </p>
              </div>

              <Link
                href={`/challenges/${challenge.slug}`}
                className="mt-10 w-fit text-sm font-medium transition-transform duration-300 group-hover:translate-x-1"
              >
                Take the challenge ↗
              </Link>
            </article>
          ))}
        </div>

      </div>
    </section>
  );
}
