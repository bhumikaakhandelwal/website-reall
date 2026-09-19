"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import {
  checkEmail,
  requestActivation,
  type ActivationStatus,
} from "@/lib/auth/activation";
import { markGateClosed, markGateOpen } from "@/lib/auth/gate";
import { requestPasswordReset } from "@/lib/profile/security";

export default function LoginPage() {
  const router = useRouter();

  const greeting = "Initializing session... Welcome back, Operator.";

  const [typedGreeting, setTypedGreeting] = useState("");
  const [email, setEmail] = useState("");
  // Phase 8D: the password. Supabase Auth owns the credential now, so the form
  // has to collect one - it never did before this phase.
  const [password, setPassword] = useState("");
  const [loginStatus, setLoginStatus] = useState<
    "idle" | "checking" | "granted" | "denied"
  >("idle");

  /*
   * Phase 8D: what the address typed into the form turned out to be.
   *
   * Only 'needs-activation' changes the page - it is the one state where the
   * member should be offered something other than "try again". The other three
   * leave the existing denied panel exactly as it was.
   */
  const [activationStatus, setActivationStatus] =
    useState<ActivationStatus | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /* ================= TYPEWRITER ================= */

  useEffect(() => {
    let index = 0;

    const typingInterval = setInterval(() => {
      setTypedGreeting(greeting.slice(0, index + 1));
      index++;

      if (index >= greeting.length) {
        clearInterval(typingInterval);
      }
    }, 45);

    return () => clearInterval(typingInterval);
  }, []);

  /* ================= LOGIN ================= */

  const handleLogin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const enteredEmail = email.trim().toLowerCase();

    setLoginStatus("checking");
    setNotice(null);
    setActivationStatus(null);

    /*
     * Supabase Auth checks the password now, so the email is no longer the
     * whole credential. The 1000ms minimum keeps the existing "scanning" state
     * visible.
     */
    const [response] = await Promise.all([
      fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: enteredEmail, password }),
      }).catch(() => null),
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]);

    if (response?.ok) {
      markGateOpen();
      setLoginStatus("granted");

      setTimeout(() => {
        router.replace("/");
      }, 1800);

      return;
    }

    markGateClosed();
    setLoginStatus("denied");

    /*
     * Phase 8D: find out WHY it failed.
     *
     * A member who has never activated gets offered "create your password"
     * instead of only "try again" - which is the whole first-time flow, and the
     * reason the 42 existing members can join without anyone emailing them.
     */
    const check = await checkEmail(enteredEmail);

    if (check.ok) setActivationStatus(check.status);
  };

  /** Sends the setup email for a member who has never activated. */
  const handleActivate = async () => {
    setBusy(true);
    setNotice(null);

    const outcome = await requestActivation(email);

    setBusy(false);
    setNotice(outcome.ok ? outcome.message : outcome.message);
  };

  /** Sends a reset link for a member who has an account and forgot the password. */
  const handleForgot = async () => {
    setBusy(true);
    setNotice(null);

    const outcome = await requestPasswordReset(email);

    setBusy(false);
    setNotice(outcome.ok ? outcome.message : outcome.message);
  };

  return (
    <main className="min-h-screen overflow-hidden bg-background px-4 py-6 md:px-8 md:py-8">
      <div className="mx-auto flex min-h-[calc(100vh-48px)] max-w-[1400px] items-center justify-center">

        {/* ================= MAIN CARD ================= */}

        <motion.div
          initial={{ opacity: 0, y: 25 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.7,
            ease: [0.22, 1, 0.36, 1],
          }}
          className="grid w-full overflow-hidden rounded-[28px] border border-border bg-background shadow-[0_20px_70px_rgba(0,0,0,0.08)] lg:grid-cols-2"
        >

          {/* ================= LEFT SIDE ================= */}

          <div className="relative flex min-h-[420px] flex-col justify-between overflow-hidden bg-primary p-8 text-primary-foreground sm:p-10 lg:min-h-[680px] lg:p-14">

            {/* Decorative circles */}

            <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full border border-accent/30" />

            <div className="pointer-events-none absolute -bottom-32 -left-32 h-80 w-80 rounded-full border border-accent/20" />

            {/* Branding */}

            <div className="relative z-10">

              <p className="font-mono text-xs font-semibold tracking-[0.25em] text-accent">
                DBCE CODERS CLUB
              </p>

              <h1 className="mt-6 max-w-md text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
                Build.
                <br />
                Break.
                <br />
                Learn.
                <br />
                <span className="text-accent">
                  Deploy.
                </span>
              </h1>

              <p className="mt-6 max-w-sm text-sm leading-6 text-primary-foreground/65 sm:text-base">
                A community where students turn ideas into projects,
                skills into experience, and curiosity into real work.
              </p>

            </div>

            {/* Robot */}

            <motion.div
              initial={{
                opacity: 0,
                scale: 0.85,
                y: 20,
              }}
              animate={{
                opacity: 1,
                scale: 1,
                y: 0,
              }}
              transition={{
                duration: 0.9,
                delay: 0.2,
                ease: [0.22, 1, 0.36, 1],
              }}
              className="relative flex flex-1 items-center justify-center py-8"
            >

              {/* Orbit */}

              <motion.div
                animate={{
                  rotate: 360,
                }}
                transition={{
                  duration: 20,
                  repeat: Infinity,
                  ease: "linear",
                }}
                className="absolute h-[230px] w-[230px] rounded-full border border-dashed border-accent/30 sm:h-[280px] sm:w-[280px]"
              />

              <motion.div
                animate={{
                  rotate: -360,
                }}
                transition={{
                  duration: 15,
                  repeat: Infinity,
                  ease: "linear",
                }}
                className="absolute h-[175px] w-[175px] rounded-full border border-dashed border-primary-foreground/10 sm:h-[215px] sm:w-[215px]"
              />

              <motion.img
                src="/robot.png"
                alt="DBCE Coders Club robot"
                animate={{
                  y: [0, -10, 0],
                }}
                transition={{
                  duration: 4,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
                className="relative z-10 h-auto w-[230px] object-contain sm:w-[290px] lg:w-[330px]"
              />

            </motion.div>

            {/* Bottom label */}

            <div className="relative z-10 flex items-center justify-between border-t border-primary-foreground/10 pt-5">

              <span className="font-mono text-[10px] tracking-[0.2em] text-primary-foreground/40">
                EST. DBCE
              </span>

              <span className="font-mono text-[10px] tracking-[0.2em] text-accent">
                KEEP BUILDING →
              </span>

            </div>

          </div>


          {/* ================= RIGHT SIDE ================= */}

          <div className="flex min-h-[420px] flex-col justify-center bg-background p-8 sm:p-10 lg:min-h-[680px] lg:p-16 xl:p-20">

            <motion.div
              initial={{
                opacity: 0,
                x: 20,
              }}
              animate={{
                opacity: 1,
                x: 0,
              }}
              transition={{
                duration: 0.7,
                delay: 0.15,
                ease: [0.22, 1, 0.36, 1],
              }}
              className="mx-auto w-full max-w-[500px]"
            >

              {/* ================= TERMINAL GREETING ================= */}

              <div className="mb-8">

                <p className="font-mono text-lg font-bold uppercase leading-relaxed tracking-[0.12em] text-accent sm:text-xl lg:text-2xl">
                  {typedGreeting}

                  <span className="ml-1 inline-block animate-pulse">
                    █
                  </span>
                </p>

              </div>


              {/* ================= HEADING ================= */}

              <div className="mb-10">

                <h2 className="text-5xl font-semibold tracking-tight sm:text-6xl lg:text-7xl">
                  Enter
                  <br />
                  <span className="text-accent">
                    your ID.
                  </span>
                </h2>

                <p className="mt-5 max-w-md text-base leading-7 text-muted-foreground">
                  Use your registered student email to access
                  the DBCE Coders Club.
                </p>

              </div>


              {/* ================= STATUS ================= */}

              {loginStatus === "granted" && (

                <motion.div
                  initial={{
                    opacity: 0,
                    scale: 0.96,
                  }}
                  animate={{
                    opacity: 1,
                    scale: 1,
                  }}
                  transition={{
                    duration: 0.5,
                  }}
                  className="flex min-h-[280px] flex-col items-center justify-center border border-accent/40 bg-accent/5 px-8"
                >

                  <motion.div
                    initial={{
                      scale: 0.7,
                      opacity: 0,
                    }}
                    animate={{
                      scale: 1,
                      opacity: 1,
                    }}
                    className="mb-6 flex h-16 w-16 items-center justify-center rounded-full border-2 border-accent"
                  >
                    <span className="text-2xl font-bold text-accent">
                      ✓
                    </span>
                  </motion.div>

                  <p className="font-mono text-2xl font-extrabold tracking-[0.18em] text-accent sm:text-3xl">
                    ACCESS GRANTED
                  </p>

                  <p className="mt-4 font-mono text-xs tracking-[0.15em] text-muted-foreground">
                    SESSION INITIALIZED _
                  </p>

                </motion.div>

              )}


              {/* ================= DENIED ================= */}

              {loginStatus === "denied" && (

                <motion.div
                  initial={{
                    opacity: 0,
                    scale: 0.96,
                  }}
                  animate={{
                    opacity: 1,
                    scale: 1,
                  }}
                  className="border border-accent/40 bg-accent/5 p-8"
                >

                  <p className="font-mono text-2xl font-extrabold tracking-[0.18em] text-accent sm:text-3xl">
                    ACCESS DENIED
                  </p>

                  {/*
                    Phase 8D: the denied panel now says WHICH kind of denied it
                    is. Before this phase there was only one reason to be
                    refused; now a member can be unknown, deactivated, or simply
                    have the wrong password - and each needs a different next
                    step.
                  */}

                  <p className="mt-4 font-mono text-xs leading-6 tracking-[0.08em] text-muted-foreground">
                    {activationStatus === "needs-activation" ? (
                      <>
                        FIRST TIME HERE? WE FOUND YOUR CLUB MEMBERSHIP.
                        <br />
                        CREATE YOUR PASSWORD.
                      </>
                    ) : activationStatus === "deactivated" ? (
                      <>
                        YOUR CLUB MEMBERSHIP IS INACTIVE.
                        <br />
                        ASK A MANAGER TO REACTIVATE YOU.
                      </>
                    ) : activationStatus === "has-account" ? (
                      <>
                        PASSWORD NOT RECOGNISED.
                        <br />
                        RESET IT, OR TRY AGAIN.
                      </>
                    ) : (
                      <>
                        EMAIL NOT FOUND IN DATABASE.
                        <br />
                        PLEASE USE YOUR REGISTERED STUDENT EMAIL.
                      </>
                    )}
                  </p>

                  <div className="mt-7 flex flex-wrap gap-3">

                    {activationStatus === "needs-activation" && (
                      <button
                        type="button"
                        onClick={handleActivate}
                        disabled={busy}
                        className="border border-border px-5 py-3 font-mono text-xs tracking-[0.12em] transition-colors hover:border-accent hover:text-accent disabled:opacity-40"
                      >
                        {busy ? "SENDING..." : "EMAIL ME A SETUP LINK →"}
                      </button>
                    )}

                    {activationStatus === "has-account" && (
                      <button
                        type="button"
                        onClick={handleForgot}
                        disabled={busy}
                        className="border border-border px-5 py-3 font-mono text-xs tracking-[0.12em] transition-colors hover:border-accent hover:text-accent disabled:opacity-40"
                      >
                        {busy ? "SENDING..." : "EMAIL ME A RESET LINK →"}
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        setLoginStatus("idle");
                        setNotice(null);
                      }}
                      className="border border-border px-5 py-3 font-mono text-xs tracking-[0.12em] transition-colors hover:border-accent hover:text-accent"
                    >
                      TRY AGAIN →
                    </button>

                  </div>

                  {notice && (
                    <p
                      role="status"
                      className="mt-5 border border-border bg-background p-4 font-mono text-[11px] leading-5 tracking-[0.06em] text-muted-foreground"
                    >
                      {notice}
                    </p>
                  )}

                </motion.div>

              )}


              {/* ================= FORM ================= */}

              {(loginStatus === "idle" ||
                loginStatus === "checking") && (

                <form
                  onSubmit={handleLogin}
                  className="space-y-7"
                >

                  <div>

                    <label
                      htmlFor="email"
                      className="mb-3 block font-mono text-xs font-bold tracking-[0.2em] text-foreground"
                    >
                      STUDENT EMAIL
                    </label>

                    <input
                      id="email"
                      type="email"
                      required
                      value={email}
                      disabled={loginStatus === "checking"}
                      onChange={(e) =>
                        setEmail(e.target.value)
                      }
                      placeholder="abc@gmail.com"
                      className="h-16 w-full border-b border-border bg-transparent px-0 font-mono text-lg outline-none transition-colors placeholder:text-muted-foreground/40 focus:border-accent disabled:opacity-50"
                    />

                  </div>

                  {/*
                    Phase 8D: the password field. Same styling as the email
                    input above so the page reads as one form, not two.
                  */}

                  <div>

                    <label
                      htmlFor="password"
                      className="mb-3 block font-mono text-xs font-bold tracking-[0.2em] text-foreground"
                    >
                      PASSWORD
                    </label>

                    <input
                      id="password"
                      type="password"
                      required
                      autoComplete="current-password"
                      value={password}
                      disabled={loginStatus === "checking"}
                      onChange={(e) =>
                        setPassword(e.target.value)
                      }
                      placeholder="••••••••"
                      className="h-16 w-full border-b border-border bg-transparent px-0 font-mono text-lg outline-none transition-colors placeholder:text-muted-foreground/40 focus:border-accent disabled:opacity-50"
                    />

                  </div>

                  {/*
                    Phase 8D: the two ways out of a failed sign-in that are not
                    "try the same thing again" - set a password for the first
                    time, or reset a forgotten one.
                  */}

                  <div className="flex flex-wrap items-center gap-x-6 gap-y-3">

                    <button
                      type="button"
                      onClick={handleForgot}
                      disabled={busy || email.trim().length === 0}
                      className="font-mono text-[10px] tracking-[0.15em] text-muted-foreground transition-colors hover:text-accent disabled:opacity-40"
                    >
                      FORGOT PASSWORD?
                    </button>

                    <button
                      type="button"
                      onClick={handleActivate}
                      disabled={busy || email.trim().length === 0}
                      className="font-mono text-[10px] tracking-[0.15em] text-muted-foreground transition-colors hover:text-accent disabled:opacity-40"
                    >
                      FIRST TIME HERE? CREATE YOUR PASSWORD
                    </button>

                  </div>

                  {notice && (
                    <p
                      role="status"
                      className="border border-border bg-muted/30 p-4 font-mono text-[11px] leading-5 tracking-[0.06em] text-muted-foreground"
                    >
                      {notice}
                    </p>
                  )}


                  <motion.button
                    type="submit"
                    disabled={loginStatus === "checking"}
                    whileHover={{
                      y: -3,
                    }}
                    whileTap={{
                      scale: 0.98,
                    }}
                    className="group flex h-16 w-full items-center justify-between bg-primary px-6 font-mono text-sm font-bold tracking-[0.08em] text-primary-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-wait disabled:opacity-60"
                  >

                    <span>
                      {loginStatus === "checking"
                        ? "SCANNING OPERATOR ID..."
                        : "INITIALIZE SESSION"}
                    </span>

                    <span className="text-xl transition-transform duration-300 group-hover:translate-x-2">
                      →
                    </span>

                  </motion.button>

                </form>

              )}

              {/* ================= FOOTER ================= */}

              <div className="mt-8 flex items-center justify-between border-t border-border pt-5">

                <span className="font-mono text-[10px] tracking-[0.15em] text-muted-foreground">
                  STUDENT ACCESS
                </span>

                <span className="font-mono text-[10px] tracking-[0.15em] text-muted-foreground">
                  DBCE / 01
                </span>

              </div>

            </motion.div>

          </div>

        </motion.div>

      </div>
    </main>
  );
}