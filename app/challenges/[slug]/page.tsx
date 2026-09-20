import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatIstDate } from "@/lib/dates";
import { Container } from "../../components/container";
import { ChallengeSubmissionForm } from "../../components/challenge-submission-form";
import { getChallengeBySlug, getMemberSubmissions } from "@/lib/db/queries";
import { getSessionMember } from "@/lib/auth/session";
import { getXpActivity } from "@/lib/xp/activities";
import {
  DIFFICULTY_LABELS,
  STATUS_LABELS,
  submissionBlockedReason,
} from "@/lib/challenges/challenges";

// Phase 9: one challenge.
//
// The XP shown is the challenge's own Handbook value, read from the database -
// the same number a manager's approval will write to the ledger. Nothing on this
// page can change it.
//
// Submissions are read only for the signed-in member, and the page never shows
// another member's work.

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const challenge = await getChallengeBySlug(slug);

  if (!challenge) return { title: "Challenge" };

  return {
    title: challenge.title,
    description: challenge.description,
  };
}

export default async function ChallengePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const challenge = await getChallengeBySlug(slug);

  if (!challenge) notFound();

  const member = await getSessionMember();

  // Read only when somebody is signed in, and only their own rows.
  const submissions = member
    ? await getMemberSubmissions(member.memberId)
    : null;

  const mine = (submissions ?? []).filter(
    (submission) => submission.challengeId === challenge.challengeId
  );

  const blocked = submissionBlockedReason(mine);

  const activity = getXpActivity(challenge.activityCode);

  return (
    <main id="main-content" tabIndex={-1} className="px-page py-section">
      <Container>
        <header className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-text">
            {DIFFICULTY_LABELS[challenge.difficulty] ?? challenge.difficulty}
            {challenge.archivedAt !== null ? " · Archived" : ""}
          </p>

          <h1 className="mt-5 text-display font-semibold leading-display tracking-[-0.055em] text-foreground">
            {challenge.title}
          </h1>

          <div className="mt-6 flex flex-wrap items-center gap-4">
            <span className="rounded-full border border-accent/40 bg-accent/10 px-4 py-2 font-mono text-sm font-semibold text-accent-text">
              {challenge.xpReward} XP
            </span>

            <span className="font-mono text-xs text-muted">
              about {challenge.estimatedHours}{" "}
              {challenge.estimatedHours === 1 ? "hour" : "hours"}
            </span>

            {activity ? (
              <span className="font-mono text-xs text-muted">
                Handbook activity: {activity.label}
              </span>
            ) : null}
          </div>

          <p className="mt-7 text-base leading-7 text-muted sm:text-lg sm:leading-8">
            {challenge.description}
          </p>

          <Link
            href="/"
            className="mt-6 inline-block border border-border px-5 py-3 font-mono text-xs tracking-[0.12em] text-foreground transition-colors hover:border-accent hover:text-accent"
          >
            ← BACK HOME
          </Link>
        </header>

        {/* Requirements ---------------------------------------------------- */}
        <section aria-labelledby="challenge-requirements" className="mt-section">
          <div className="flex items-baseline gap-4">
            <span className="font-mono text-xs text-accent-text">01</span>

            <h2
              id="challenge-requirements"
              className="text-3xl font-semibold tracking-[-0.045em] text-foreground sm:text-4xl"
            >
              What counts
            </h2>
          </div>

          <p className="mt-6 max-w-2xl whitespace-pre-line text-base leading-7 text-muted">
            {challenge.requirements}
          </p>
        </section>

        {/* Submission ------------------------------------------------------ */}
        <section aria-labelledby="challenge-submit" className="mt-section">
          <div className="flex items-baseline gap-4">
            <span className="font-mono text-xs text-accent-text">02</span>

            <h2
              id="challenge-submit"
              className="text-3xl font-semibold tracking-[-0.045em] text-foreground sm:text-4xl"
            >
              Submit it
            </h2>
          </div>

          <p className="mt-6 max-w-2xl text-base leading-7 text-muted">
            Submitting does not earn XP. A manager reviews it first, and only an
            approval writes to the XP ledger — once.
          </p>

          {challenge.archivedAt !== null ? (
            <p className="mt-6 max-w-xl border border-border bg-surface p-6 text-sm leading-6 text-muted">
              This challenge has been archived, so it is no longer accepting
              submissions. Anything you already submitted is still being
              reviewed.
            </p>
          ) : !member ? (
            <p className="mt-6 max-w-xl border border-border bg-surface p-6 text-sm leading-6 text-muted">
              <Link href="/login" className="text-foreground underline">
                Sign in
              </Link>{" "}
              to take this challenge.
            </p>
          ) : blocked ? (
            <p className="mt-6 max-w-xl border border-border bg-surface p-6 text-sm leading-6 text-muted">
              {blocked}
            </p>
          ) : (
            <ChallengeSubmissionForm
              slug={challenge.slug}
              submissionType={challenge.submissionType}
              // The activity decides what the primary field is CALLED; the
              // submission type decides whether it is a URL or a written answer.
              activityCode={challenge.activityCode}
            />
          )}
        </section>

        {/* This member's attempts ------------------------------------------ */}
        {mine.length > 0 && (
          <section aria-labelledby="challenge-history" className="mt-section">
            <div className="flex items-baseline gap-4">
              <span className="font-mono text-xs text-accent-text">03</span>

              <h2
                id="challenge-history"
                className="text-3xl font-semibold tracking-[-0.045em] text-foreground sm:text-4xl"
              >
                Your submissions
              </h2>
            </div>

            <ul className="mt-8 max-w-2xl overflow-hidden rounded-panel border border-border">
              {mine.map((submission) => (
                <li
                  key={submission.submissionId}
                  className="border-t border-border px-5 py-4 first:border-t-0 sm:px-6"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="font-mono text-xs tracking-[0.1em] text-foreground">
                      {STATUS_LABELS[submission.status].toUpperCase()}
                    </span>

                    <span className="font-mono text-xs text-muted">
                      {formatIstDate(
                        submission.reviewedAt ?? submission.createdAt
                      )}
                    </span>
                  </div>

                  {submission.githubUrl ? (
                    <p className="mt-2 truncate font-mono text-xs text-muted">
                      {submission.githubUrl}
                    </p>
                  ) : null}

                  {submission.submissionText ? (
                    <p className="mt-2 whitespace-pre-line text-sm leading-6 text-muted">
                      {submission.submissionText}
                    </p>
                  ) : null}

                  {submission.managerFeedback ? (
                    <p className="mt-3 border-l-2 border-accent/40 pl-3 text-sm leading-6 text-foreground">
                      {submission.managerFeedback}
                    </p>
                  ) : null}

                  {submission.status === "approved" && submission.xpLedgerId !== null ? (
                    <p className="mt-3 font-mono text-xs text-accent-text">
                      +{challenge.xpReward} XP awarded
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        )}
      </Container>
    </main>
  );
}
