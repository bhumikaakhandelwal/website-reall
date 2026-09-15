"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "motion/react";
import { Container } from "./container";
import type { MemberProfile } from "@/lib/db/types";

const navigation = [
  { label: "Home", href: "/" },
  { label: "About", href: "/#about" },
  { label: "Activities", href: "/#activities" },
  { label: "Hackathon", href: "/#hackathon" },
  { label: "Challenges", href: "/#open-challenges" },
  { label: "Leaderboard", href: "/leaderboard" },
  { label: "XP System", href: "/xp-system" },
  {
    label: "GitHub",
    href: "https://github.com/DBCE-Coders-Club",
  },
] as const;

// Level icons
const levelIcons: Record<number, string> = {
  1: "/level-icons/level-1.png",
  2: "/level-icons/level-2.png",
  3: "/level-icons/level-3.png",
  4: "/level-icons/level-4.png",
  5: "/level-icons/level-5.png",
  6: "/level-icons/level-6.png",
  7: "/level-icons/level-7.png",
};

// Shape of GET /api/xp/me.
// Level titles and XP thresholds are deliberately NOT duplicated here — the
// server derives them from the levels table (lib/xp/levels.ts) and sends them.
type MemberXp = {
  memberId: string;
  totalXp: number;
  level: number;
  levelName: string;
  nextLevelXp: number | null;
};

export function GlobalNavigation() {
  const pathname = usePathname();
  const router = useRouter();

  const [profileOpen, setProfileOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  // Phase 2: the logged-in member's identity. Source of truth is the signed
  // server session (via /api/auth/me); localStorage is only the UI gate.
  const [member, setMember] = useState<MemberProfile | null>(null);

  // Phase 3: the logged-in member's XP and level, from the server's ledger
  // sum. Null until the response arrives.
  const [xp, setXp] = useState<MemberXp | null>(null);

  const menuButtonRef = useRef<HTMLButtonElement>(null);

  // Phase 3: progression is server-derived — no placeholder values remain.
  const currentLevel = xp?.level ?? 1;
  const currentXP = xp?.totalXp ?? 0;
  const nextLevelXP = xp?.nextLevelXp ?? null;

  const progress =
    nextLevelXP === null
      ? 100
      : Math.min((currentXP / nextLevelXP) * 100, 100);

  // Logout
  const handleLogout = () => {
    localStorage.removeItem("dbce-logged-in");
    // Fire-and-forget: clear the server session cookie.
    fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    setProfileOpen(false);
    router.replace("/login");
  };

  // Close mobile menu with Escape
  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMenuOpen]);

  useEffect(() => {
  setProfileOpen(false);
  setIsMenuOpen(false);
}, [pathname]);

  // Load the current member once per mount. The response is the only thing
  // that decides who the visitor is — no client value is trusted as identity.
  useEffect(() => {
    const controller = new AbortController();

    async function loadCurrentMember() {
      try {
        const [memberResponse, xpResponse] = await Promise.all([
          fetch("/api/auth/me", { signal: controller.signal }),
          fetch("/api/xp/me", { signal: controller.signal }),
        ]);

        // The server session is gone (expired or cleared): drop the client
        // gate and send the visitor back to the login screen.
        if (memberResponse.status === 401 || memberResponse.status === 404) {
          localStorage.removeItem("dbce-logged-in");
          router.replace("/login");
          return;
        }

        if (memberResponse.ok) {
          const data: { user?: MemberProfile } = await memberResponse.json();

          if (data.user) {
            setMember(data.user);
          }
        }

        // The XP endpoint derives the total from the ledger; its own 401/404
        // mirrors the member check above, so a failure here just leaves the
        // panel in its loading state.
        if (xpResponse.ok) {
          const data: MemberXp = await xpResponse.json();
          setXp(data);
        }
      } catch {
        // Aborted or unreachable — the profile stays in its loading state.
      }
    }

    loadCurrentMember();

    return () => controller.abort();
  }, [router]);

  // Login page should not show navbar
  if (pathname === "/login") {
    return null;
  }

  return (
    <header className="border-b border-border bg-background">
      <Container className="flex min-h-[var(--nav-height)] items-center justify-between gap-6 px-page">

        {/* LOGO */}

        <Link
          href="/"
          className="text-sm font-semibold tracking-tight text-foreground"
        >
          DBCE Coders Club
        </Link>

        <nav aria-label="Primary navigation" className="relative">

          {/* ================= DESKTOP NAV ================= */}

          <div className="hidden items-center gap-1 sm:flex">

            <ul className="flex items-center gap-1">
              {navigation.map((item) => {
                const isCurrentPage = pathname === item.href;

                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={
                        isCurrentPage ? "page" : undefined
                      }
                      className={`rounded-card px-3 py-2 text-sm font-medium transition-colors ${
                        isCurrentPage
                          ? "bg-surface text-foreground"
                          : "text-muted hover:bg-surface hover:text-foreground"
                      }`}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>

            {/* ================= PROFILE ================= */}

            <div className="relative ml-3">

              {/* PROFILE BUTTON */}

              <motion.button
                type="button"
                onClick={() =>
                  setProfileOpen((value) => !value)
                }
                whileTap={{ scale: 0.95 }}
                className="group flex items-center gap-2 rounded-full border border-border p-1 pr-3 transition-all duration-300 hover:border-accent"
                aria-label="Open student profile"
              >
                <div className="relative h-9 w-9 overflow-hidden rounded-full border border-border bg-muted">

                  <Image
                    src={levelIcons[currentLevel]}
                    alt={`Level ${currentLevel}`}
                    fill
                    sizes="36px"
                    className="object-cover transition-transform duration-300 group-hover:scale-110"
                  />

                </div>

                <div className="hidden text-left sm:block">

                  <p className="font-mono text-[9px] tracking-[0.12em] text-muted-foreground">
                    LVL
                  </p>

                  <p className="text-xs font-semibold">
                    {currentLevel}
                  </p>

                </div>
              </motion.button>


              {/* ================= PROFILE DROPDOWN ================= */}

              <AnimatePresence>
                {profileOpen && (
                  <motion.div
                    initial={{
                      opacity: 0,
                      y: -8,
                      scale: 0.97,
                    }}
                    animate={{
                      opacity: 1,
                      y: 0,
                      scale: 1,
                    }}
                    exit={{
                      opacity: 0,
                      y: -8,
                      scale: 0.97,
                    }}
                    transition={{
                      duration: 0.2,
                    }}
                    className="absolute right-0 top-14 z-[100] w-[330px] overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
                  >

                    {/* PROFILE HEADER */}

                    <div className="relative overflow-hidden border-b border-border p-6">

                      <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-accent/10 blur-2xl" />

                      <div className="relative flex items-center gap-4">

                        {/* LARGE LEVEL ICON */}

                        <motion.div
                          initial={{ rotate: -8 }}
                          animate={{ rotate: 0 }}
                          className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-accent/30 bg-muted"
                        >
                          <Image
                            src={levelIcons[currentLevel]}
                            alt={`Level ${currentLevel}`}
                            fill
                            sizes="80px"
                            className="object-cover"
                          />
                        </motion.div>


                        {/* STUDENT INFORMATION */}

                        <div className="min-w-0">

                          <p className="font-mono text-[9px] tracking-[0.2em] text-muted-foreground">
                            OPERATOR
                          </p>

                          {member ? (
                            <p className="mt-1 truncate text-lg font-bold">
                              {member.display_name}
                            </p>
                          ) : (
                            <span
                              aria-hidden="true"
                              className="mt-1 block h-7 w-40 animate-pulse rounded bg-muted"
                            />
                          )}

                          <div className="mt-2 flex items-center gap-2">

                            <span className="font-mono text-[10px] font-bold text-accent">
                              LEVEL {currentLevel}
                            </span>

                            <span className="text-muted-foreground">
                              /
                            </span>

                            <span className="font-mono text-[10px] text-muted-foreground">
                              {xp?.levelName ?? ""}
                            </span>

                          </div>

                        </div>

                      </div>

                    </div>


                    {/* ================= XP ================= */}

                    <div className="p-6">

                      <div className="mb-3 flex items-end justify-between">

                        <div>

                          <p className="font-mono text-[9px] tracking-[0.18em] text-muted-foreground">
                            EXPERIENCE
                          </p>

                          <p className="mt-1 text-xl font-bold">
                            {currentXP.toLocaleString()} XP
                          </p>

                        </div>

                        <p className="font-mono text-[10px] text-muted-foreground">
                          {nextLevelXP === null
                            ? "MAX LEVEL"
                            : `${nextLevelXP.toLocaleString()} XP`}
                        </p>

                      </div>


                      {/* XP BAR */}

                      <div className="h-2 overflow-hidden rounded-full bg-muted">

                        <motion.div
                          initial={{ width: 0 }}
                          animate={{
                            width: `${progress}%`,
                          }}
                          transition={{
                            duration: 0.8,
                            ease: [0.22, 1, 0.36, 1],
                          }}
                          className="h-full rounded-full bg-accent"
                        />

                      </div>


                      {/* NEXT LEVEL */}

                      {nextLevelXP !== null && (
                        <div className="mt-3 flex justify-between">

                          <span className="font-mono text-[9px] tracking-[0.1em] text-muted-foreground">
                            NEXT LEVEL
                          </span>

                          <span className="font-mono text-[9px] text-accent">
                            {(
                              nextLevelXP - currentXP
                            ).toLocaleString()}{" "}
                            XP TO GO
                          </span>

                        </div>
                      )}

                    </div>


                    {/* ================= ACTIONS ================= */}

                    <div className="border-t border-border">

                      {/* XP SYSTEM */}

                      <button
                        type="button"
                        onClick={() => {
                          setProfileOpen(false);
                          router.push("/xp-system");
                        }}
                        className="group flex w-full items-center justify-between px-6 py-4 text-left transition-colors hover:bg-muted"
                      >

                        <div>

                          <p className="font-mono text-[10px] font-bold tracking-[0.12em]">
                            VIEW XP SYSTEM
                          </p>

                          <p className="mt-1 text-xs text-muted-foreground">
                            View your progression and titles
                          </p>

                        </div>

                        <span className="text-lg transition-transform duration-300 group-hover:translate-x-1">
                          →
                        </span>

                      </button>


                      {/* LOGOUT */}

                      <button
                        type="button"
                        onClick={handleLogout}
                        className="group flex w-full items-center justify-between border-t border-border px-6 py-4 text-left transition-colors hover:bg-accent hover:text-accent-foreground"
                      >

                        <div>

                          <p className="font-mono text-[10px] font-bold tracking-[0.12em]">
                            LOGOUT
                          </p>

                          <p className="mt-1 text-xs opacity-60">
                            End current session
                          </p>

                        </div>

                        <span className="text-lg transition-transform duration-300 group-hover:translate-x-1">
                          →
                        </span>

                      </button>

                    </div>

                  </motion.div>
                )}
              </AnimatePresence>

            </div>

          </div>


          {/* ================= MOBILE MENU BUTTON ================= */}

          <button
            ref={menuButtonRef}
            type="button"
            aria-controls="mobile-navigation"
            aria-expanded={isMenuOpen}
            aria-label={
              isMenuOpen
                ? "Close menu"
                : "Open menu"
            }
            className="flex size-10 items-center justify-center rounded-card text-foreground hover:bg-surface sm:hidden"
            onClick={() =>
              setIsMenuOpen((isOpen) => !isOpen)
            }
          >

            <svg
              aria-hidden="true"
              className="size-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="1.75"
            >

              {isMenuOpen ? (
                <path
                  strokeLinecap="round"
                  d="m6 6 12 12M18 6 6 18"
                />
              ) : (
                <path
                  strokeLinecap="round"
                  d="M4 7h16M4 12h16M4 17h16"
                />
              )}

            </svg>

          </button>


          {/* ================= MOBILE NAVIGATION ================= */}

          {isMenuOpen && (
            <div
              id="mobile-navigation"
              className="absolute right-0 top-full z-20 mt-3 w-56 rounded-card border border-border bg-background p-2 shadow-[0_12px_32px_rgb(21_21_19_/_0.08)] sm:hidden"
            >

              <ul>

                {navigation.map((item) => {
                  const isCurrentPage =
                    pathname === item.href;

                  return (
                    <li key={item.href}>

                      <Link
                        href={item.href}
                        aria-current={
                          isCurrentPage
                            ? "page"
                            : undefined
                        }
                        className={`block rounded-[calc(var(--radius-card)-0.25rem)] px-3 py-2 text-sm font-medium ${
                          isCurrentPage
                            ? "bg-surface text-foreground"
                            : "text-muted hover:bg-surface hover:text-foreground"
                        }`}
                        onClick={() =>
                          setIsMenuOpen(false)
                        }
                      >
                        {item.label}
                      </Link>

                    </li>
                  );
                })}

              </ul>

              {/* MOBILE PROFILE */}

              <div className="mt-2 border-t border-border pt-2">

                <button
                  type="button"
                  onClick={() =>
                    setProfileOpen(
                      (value) => !value
                    )
                  }
                  className="flex w-full items-center gap-3 rounded-card px-3 py-3 text-left hover:bg-surface"
                >

                  <div className="relative h-10 w-10 overflow-hidden rounded-full border border-border">

                    <Image
                      src={levelIcons[currentLevel]}
                      alt={`Level ${currentLevel}`}
                      fill
                      sizes="40px"
                      className="object-cover"
                    />

                  </div>

                  <div>

                    {member ? (
                      <p className="text-sm font-semibold">
                        {member.display_name}
                      </p>
                    ) : (
                      <span
                        aria-hidden="true"
                        className="block h-5 w-32 animate-pulse rounded bg-muted"
                      />
                    )}

                    <p className="font-mono text-[9px] tracking-[0.1em] text-muted-foreground">
                      LEVEL {currentLevel}
                    </p>

                  </div>

                </button>


                {profileOpen && (
                  <div className="mt-2 border-t border-border pt-2">

                    <Link
                      href="/xp-system"
                      onClick={() =>
                        setIsMenuOpen(false)
                      }
                      className="block px-3 py-2 text-xs hover:text-accent"
                    >
                      VIEW XP SYSTEM →
                    </Link>

                    <button
                      type="button"
                      onClick={handleLogout}
                      className="w-full px-3 py-2 text-left text-xs hover:text-accent"
                    >
                      LOGOUT →
                    </button>

                  </div>
                )}

              </div>

            </div>
          )}

        </nav>

      </Container>
    </header>
  );
}