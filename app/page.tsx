import { constants } from "buffer";
import type { Metadata } from "next";
import Link from "next/link";
import { OpenChallenges } from "./components/open-challanges";
import { getChallenges } from "@/lib/db/queries";
import {
  EXECUTIVE_COUNCIL,
  councilNumber,
  isSharedRole,
  roleMarker,
  rolePosition,
  roleSize,
} from "./content/council";

export const metadata: Metadata = {
  title: "Home",
  description:
    "The official website of DBCE Coders Club at Don Bosco College of Engineering.",
};




const faqs = [
  [
    "Who can join the club?",
    "Anyone at DBCE with curiosity and a willingness to contribute.",
  ],
  [
    "What happens at a workshop?",
    "Members learn a practical technology and build something together.",
  ],
  [
    "How do I get involved?",
    "Join an event, solve a challenge, contribute to a project, or reach out to the council.",
  ],
];

// Phase 9: the homepage reads the real challenge catalogue.
//
// It is a server component, so it reads through the query layer directly rather
// than through a public API - there is nothing to expose to the browser, and a
// challenge list is not per-member.
//
// A FAILED READ RENDERS NO CARDS rather than an empty section: `getChallenges`
// returns null for an error and [] for a genuinely empty catalogue, and both
// mean "nothing to show here" on a public page. The alternative - a heading with
// no cards under it - reads as a broken site.
export default async function Home() {
  const challenges = (await getChallenges()) ?? [];

  return (
    <main id="main-content" tabIndex={-1} className="home-page">
      {/* HERO */}
      <section className="home-hero">
        <div className="hero-copy">
          <p className="eyebrow">DBCE CODERS CLUB · GOA</p>
          <h1>
            Build. Break.
            <span>Learn.</span>
            <span>Deploy.</span>
          </h1>
          <br></br>
          <p className="hero-description">
            A student technology community for curious minds who learn by
            building.
          </p>

          <div className="hero-actions">
            <Link className="dark-button" href="#mission">
              Explore the club ↗
            </Link>
            <Link className="underlined-link" href="#join">
              Become a member →
            </Link>
          </div>
        </div>

        <div className="hero-visual" aria-hidden="true">
          <div className="orbit orbit-a" />
          <div className="orbit orbit-b" />
          <div className="orbit orbit-c" />
          <div className="hero-device">
            <div className="device-top">
              <span>DBCE</span>
              <span>01</span>
            </div>
            <div className="device-code">
              <span>const</span> future = <b>build()</b>;
              <br />
              <span>while</span> (learning) {"{"}
              <br />
              &nbsp;&nbsp;ship();
              <br />
              {"}"}
            </div>
            <div className="device-bottom">CODERS CLUB</div>
          </div>
        </div>
      </section>


 <div className="overflow-hidden py-5">
  <div className="animate-marquee flex w-max whitespace-nowrap">
    {Array.from({ length: 4 }).map((_, repeat) => (
      <div
        key={repeat}
        className="flex shrink-0 items-center"
      >
        <span className="px-8 text-2xl font-bold tracking-wide md:text-4xl">
          BUILD
        </span>

        <span className="text-accent">✦</span>

        <span className="px-8 text-2xl font-bold tracking-wide md:text-4xl">
          BREAK
        </span>

        <span className="text-accent">✦</span>

        <span className="px-8 text-2xl font-bold tracking-wide md:text-4xl">
          LEARN
        </span>

        <span className="text-accent">✦</span>

        <span className="px-8 text-2xl font-bold tracking-wide md:text-4xl">
          DEPLOY
        </span>

        <span className="text-accent px-8">✦</span>
      </div>
    ))}
  </div>
</div>
  

      {/* MISSION */}
      <section id="about">
      <section id="mission" className="editorial-section two-column-section">
        <div>
          <p className="eyebrow">WHO WE ARE</p>
          <h2>
            Mission.
            <span>Build together.</span>
          </h2>
        </div>

        <div className="editorial-copy">
          <p className="large-statement">
            To build a vibrant community of programmers, innovators and
            problem-solvers by promoting coding culture, hackathons,
            open-source development and technical excellence.
          </p>
          <p>
            DBCE Coders Club brings together students who want to learn,
            create and make a mark beyond the classroom.
          </p>
        </div>
      </section>
</section>
      
      {/* THREE PILLARS */}
<section className="editorial-section pillars-section">
  <div className="section-label">
    <p className="eyebrow">THE APPROACH</p>
    <h2>Three pillars.</h2>

    <p className="section-description">
      Focus on learning through building.
    </p>
    <div className="mt-12 max-w-sm border-l-2 border-accent pl-6">
  <p className="text-2xl font-display italic leading-relaxed md:text-3xl">
    “We don’t just learn technology. We build with it,
    solve real problems, and compete to grow.”
  </p>

  <p className="mt-5 font-mono text-xs uppercase tracking-widest text-muted-foreground">
    — DBCE Coders Club
  </p>
</div>
  </div>

 <div className="editorial-list">
  <article>
    <small>01</small>

    <div className="pillar-icon">
      ◈
    </div>

    <div className="pillar-content">
      <h3>Explore</h3>
      <p>
        Students discover advanced tools and technologies.
      </p>
    </div>
  </article>

  <article>
    <small>02</small>

    <div className="pillar-icon">
      &lt;/&gt;
    </div>

    <div className="pillar-content">
      <h3>Build</h3>
      <p>
        Students build real systems and prototypes.
      </p>
    </div>
  </article>

  <article>
    <small>03</small>

    <div className="pillar-icon">
      ✦
    </div>

    <div className="pillar-content">
      <h3>Compete</h3>
      <p>
        Students participate in national-level hackathons.
      </p>
    </div>
  </article>
</div>
  </section>
<div id="open-challenges">
  <OpenChallenges
    challenges={challenges.map((challenge) => ({
      slug: challenge.slug,
      title: challenge.title,
      xpReward: challenge.xpReward,
      difficulty: challenge.difficulty,
      description: challenge.description,
    }))}
  />
</div>
<section id="hackathon">
      {/* HACKATHON */}
      <section className="dark-panel two-column-section">
        <div>
          <p className="eyebrow light-eyebrow">FLAGSHIP EVENT</p>
          <h2>
            Annual
            <span>Hackathon.</span>
          </h2>
          <p className="dark-copy">
            A two-phase experience designed to push students beyond beginner
            programming and introduce real software architecture.
          </p>
        </div>

        <div className="dark-list">
          <article>
            <small>01</small>
            <div>
              <h3>In-Campus Challenge</h3>
              <p>
                Teams of 2–3 work on carefully designed problem statements.
                Their work is evaluated by ambassadors, internal faculty, and
                external experts.
              </p>
            </div>
          </article>
          <article>
            <small>02</small>
            <div>
              <h3>Offshore Event</h3>
              <p>
                A 24-hour hackathon where teams select real-world problem
                tracks and compete to build the best prototype solution.
              </p>
            </div>
          </article>
          <Link className="lime-button" href="/hackathon">
            Explore the hackathon ↗
          </Link>
        </div>
      </section>
</section>
      {/* BEYOND */}
      <section id="activities">
      <section className="editorial-section two-column-section">
        <div>
          <p className="eyebrow">WHAT COMES NEXT</p>
          <h2>
            Beyond the
            <span>Hackathon.</span>
          </h2>
          <p className="section-description">
            The roadmap also includes panel discussions, industry field
            visits, and opportunities connected to developer and AI
            conferences.
          </p>
        </div>

        <div className="editorial-list compact">
          <article>
            <small>01</small>
            <div>
              <h3>Panel Discussions</h3>
              <p>Engineers share insights into how real systems are built.</p>
            </div>
          </article>
          <article>
            <small>02</small>
            <div>
              <h3>Industry Field Visits</h3>
              <p>Students get direct exposure to R&amp;D teams.</p>
            </div>
          </article>
          <article>
            <small>03</small>
            <div>
              <h3>Conference Participation</h3>
              <p>Opportunities connected to developer and AI conferences.</p>
            </div>
          </article>
        </div>
      </section>
</section>
   {/* XP */}
      <section className="dark-panel xp-panel">
        <div className="grid grid-cols-1 gap-12 md:grid-cols-2 md:gap-20">
  {/* LEFT */}
  <div>
    <p className="label-eyebrow text-muted-foreground mb-6">
      EXECUTIVE COUNCIL
    </p>

    <h2 className="font-display text-7xl font-medium leading-[0.85] tracking-tight text-white md:text-8xl lg:text-9xl">
      Earn your
      <br />
      <span className="text-lime-400">place.</span>
    </h2>
  </div>

  {/* RIGHT */}
  <div className="flex flex-col justify-center">
    <p className="max-w-2xl font-display text-3xl font-medium leading-tight text-white md:text-4xl lg:text-5xl">
      Learn, build, ship and earn points for your contribution to the club.
    </p>

    {/* Four paths */}
    <div className="mt-10 grid grid-cols-2 border-t border-white/20 md:grid-cols-4">
      
      <div className="border-r border-white/20 px-5 py-6 first:pl-0">
        <div className="mb-5 text-3xl text-accent">◈</div>
        <h3 className="text-lg font-semibold text-white">Learn</h3>
        <p className="mt-3 text-sm leading-relaxed text-white/60">
          Attend workshops, sessions and level up your skills.
        </p>
      </div>

      <div className="border-r border-white/20 px-5 py-6">
        <div className="mb-5 text-3xl text-accent">&lt;/&gt;</div>
        <h3 className="text-lg font-semibold text-white">Build</h3>
        <p className="mt-3 text-sm leading-relaxed text-white/60">
          Work on projects, solve challenges and create impact.
        </p>
      </div>

      <div className="border-r border-white/20 px-5 py-6">
        <div className="mb-5 text-3xl text-accent">↗</div>
        <h3 className="text-lg font-semibold text-white">Ship</h3>
        <p className="mt-3 text-sm leading-relaxed text-white/60">
          Deploy your ideas and contribute to real-world solutions.
        </p>
      </div>

      <div className="px-5 py-6 last:pr-0">
        <div className="mb-5 text-3xl text-accent">☆</div>
        <h3 className="text-lg font-semibold text-white">Earn</h3>
        <p className="mt-3 text-sm leading-relaxed text-white/60">
          Gain XP, climb the leaderboard and earn your place.
        </p>
      </div>

    </div>
  </div>
</div>

        {/*
          Phase 10A: the Council Showcase.

          Replaces the three-card XP strip. No XP appears here at all - council
          office is service, not points - and the numbering in the corner is a
          decorative counter, not a ranking. The President leads the array in
          app/content/council.ts, so the featured lime card follows from the data
          rather than being a special case.

          3 columns on desktop, 2 on tablet, 1 on mobile. The cards carry the
          same charcoal-and-lime palette, mono micro-labels and tight tracking as
          the rest of the panel; the hover lift and the thin orange rule are the
          only additions, and both are restrained.
        */}
        <div className="mt-16 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {EXECUTIVE_COUNCIL.map((member, index) => {
            const featured = index === 0;

            // A role held by more than one member - the two Tech Leads, the
            // three PR & Outreach - is marked so it reads as a shared post
            // rather than a title someone typed twice. Derived from the title,
            // never from a list of names: see app/content/council.ts.
            const shared = isSharedRole(member.title);
            const marker = roleMarker(member.title);

            return (
              <article
                key={member.name}
                className={[
                  // The President sits ~15% taller than the rest, so the card
                  // anchors the section without leaving its column.
                  featured ? "min-h-[230px]" : "min-h-[200px]",
                  "group relative flex flex-col overflow-hidden border-t-2 p-6",
                  "transition-all duration-300 ease-out hover:-translate-y-1",
                  featured
                    ? // `bg-[var(--lime)]`, NOT `bg-lime`: there is no
                      // `--color-lime` in the Tailwind theme, so `bg-lime`
                      // compiles to nothing and the card fell back to the dark
                      // panel behind it - leaving dark text on a dark ground.
                      // This is the club's lime, the same one the old XP strip
                      // used.
                      "border-accent bg-[var(--lime)] text-foreground"
                    : shared
                      ? // The shared accent: the same orange rule on every
                        // holder, lit permanently rather than only on hover, and
                        // the same faint glow, so the group reads as a set even
                        // where the grid breaks between two of its cards.
                        "border-accent/35 bg-gradient-to-b from-[#2f342e] to-[#22261f] text-white shadow-[0_0_30px_-16px_rgba(232,92,61,0.6)] hover:border-accent hover:shadow-[0_18px_40px_-24px_rgba(232,92,61,0.55)]"
                      : "border-transparent bg-gradient-to-b from-[#2f342e] to-[#22261f] text-white hover:border-accent hover:shadow-[0_18px_40px_-24px_rgba(232,92,61,0.55)]",
                ].join(" ")}
              >
                {featured && (
                  <span className="absolute right-6 top-6 font-mono text-[0.6rem] font-bold uppercase tracking-[0.18em] text-accent-text">
                    President
                  </span>
                )}

                <small
                  className={[
                    "font-mono text-[0.7rem] tracking-[0.18em]",
                    featured ? "text-foreground/60" : "text-accent",
                  ].join(" ")}
                >
                  {councilNumber(index)}
                </small>

                <strong className="mt-auto block text-xl font-semibold leading-tight tracking-[-0.02em]">
                  {member.name}
                </strong>

                <span
                  className={[
                    "mt-2 font-mono text-[0.7rem] uppercase tracking-[0.14em]",
                    // Dark on lime, and orange on charcoal. The badge carries
                    // the orange on the featured card instead.
                    featured ? "text-foreground/70" : "text-accent",
                  ].join(" ")}
                >
                  {marker !== null && (
                    <>
                      <span aria-hidden="true" className="mr-2 tracking-[0.1em]">
                        {marker}
                      </span>

                      {/* The glyph carries the meaning visually; this is what a
                          screen reader gets instead of a row of diamonds. */}
                      <span className="sr-only">
                        Shared role, {rolePosition(member)} of{" "}
                        {roleSize(member.title)}.{" "}
                      </span>
                    </>
                  )}

                  {member.title}
                </span>
              </article>
            );
          })}
        </div>

        {/* A restrained terminal-style scan, matching the site's
            "INITIALIZING SESSION..." register. Decorative, and it stops for
            anyone who has asked for reduced motion. */}
        <div aria-hidden="true" className="council-scan mt-10" />

        
      </section>

      {/* FAQ */}
      <section className="editorial-section two-column-section">
        <div>
          <p className="eyebrow">GOOD TO KNOW</p>
          <h2>
            Questions,
            <span>answered.</span>
          </h2>
        </div>

        <div className="faq-list">
          {faqs.map(([question, answer]) => (
            <details key={question}>
              <summary>
                {question}
                <span>+</span>
              </summary>
              <p>{answer}</p>
            </details>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section id="join" className="orange-panel">
        <div>
          <p className="eyebrow dark-eyebrow">READY?</p>
          <h2>Let&apos;s build.</h2>
        </div>
        <Link className="dark-button" href="mailto:codersclub@dbce.edu.in">
          Join the movement ↗
        </Link>
      </section>
    </main>
  );
}
