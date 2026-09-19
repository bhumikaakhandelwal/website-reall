"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { GlobalNavigation } from "./global-navigation";
import { SiteFooter } from "./site-footer";

/**
 * Pages that render without a session.
 *
 * `/login` is the sign-in page itself. `/auth/callback` is where every emailed
 * auth link lands, and gating it was a bug: the member is NOT signed in yet -
 * establishing that session is exactly what the page does - so this gate would
 * bounce them to /login before the URL fragment carrying their tokens could be
 * read, and the link would appear expired.
 */
const PUBLIC_PATHS = ["/login", "/auth/callback"];

export default function LoginGate({
  children,
}: {
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const loggedIn = localStorage.getItem("dbce-logged-in");

    if (!loggedIn && !PUBLIC_PATHS.includes(pathname)) {
      router.replace("/login");
      return;
    }

    if (loggedIn && pathname === "/login") {
      router.replace("/");
      return;
    }

    setChecking(false);
  }, [pathname, router]);

  if (checking) {
    return (
      <div className="min-h-screen bg-background" />
    );
  }

  // Sign-in and the auth callback get NO navbar or footer. Neither is a page of
  // the site: one is the door, the other is a moment in the middle of opening
  // it.
  if (PUBLIC_PATHS.includes(pathname)) {
    return <>{children}</>;
  }

  // All normal website pages get navbar + footer
  return (
    <>
      <GlobalNavigation />

      {children}

      <SiteFooter />
    </>
  );
}