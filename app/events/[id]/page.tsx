import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "../../components/container";
import { AttendanceManager } from "../../components/attendance-manager";

export const metadata: Metadata = {
  title: "Event attendance",
  description:
    "Record who attended a DBCE Coders Club event, and award them the event's Handbook activity.",
};

// Phase 7B: the manager-only attendance page for one event.
//
// Like every other page here, it is not access-controlled itself — the site's
// gate is a client-side indicator and always has been. The DATA is what is
// protected: the attendance and award routes answer 401 without a session and
// 403 for anyone outside the two-email manager allowlist, so a normal member
// sees the "Managers only" state rather than the roster.
//
// The page header is deliberately generic: the event's own title, date, type
// and activity are not known until the API answers, so the component renders
// them. Putting them in the header would mean either a server-side read this
// page has no business doing, or a header that flickers from "Event." to the
// real title.
//
// Visual language is the existing one (/events, /manager, /members): same
// header treatment, same numbered section headings, same panel + row list. No
// new tokens, no restyling.
export default async function EventAttendancePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <main id="main-content" tabIndex={-1} className="px-page py-section">
      <Container>
        <header className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-text">
            Manager tools
          </p>

          <h1 className="mt-5 text-display font-semibold leading-display tracking-[-0.055em] text-foreground">
            Attendance.
          </h1>

          <p className="mt-7 text-base leading-7 text-muted sm:text-lg sm:leading-8">
            Record who came, then award them the Handbook activity this event
            names. Visible to XP managers only.
          </p>

          <Link
            href="/events"
            className="mt-6 inline-block border border-border px-5 py-3 font-mono text-xs tracking-[0.12em] text-foreground transition-colors hover:border-accent hover:text-accent"
          >
            ← BACK TO THE REGISTER
          </Link>
        </header>

        <AttendanceManager eventId={id} />
      </Container>
    </main>
  );
}
