"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { GlobalNavigation } from "./global-navigation";
import { SiteFooter } from "./site-footer";

/*
 * ==========================================
 * INAUGURATION MODE
 * ==========================================
 *
 * true  -> Homepage is accessible without login
 * false -> Normal login protection is restored
 */
const INAUGURATION_MODE = true;

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

    /*
     * ==========================================
     * INAUGURATION MODE
     * ==========================================
     *
     * Allow everyone to enter the website.
     *
     * The login page still exists.
     * We are NOT deleting or disabling it.
     */
    if (INAUGURATION_MODE) {
      setChecking(false);
      return;
    }

    /*
     * ==========================================
     * NORMAL LOGIN MODE
     * ==========================================
     */

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

  /*
   * Loading state
   */
  if (checking) {
    return (
      <div className="min-h-screen bg-background" />
    );
  }

  /*
   * Login page does NOT get navbar.
   */
  if (PUBLIC_PATHS.includes(pathname)) {
    return <>{children}</>;
  }

  /*
   * ==========================================
   * NORMAL WEBSITE
   * ==========================================
   *
   * Navbar + page + footer
   */
  return (
    <>
      <GlobalNavigation />

      {children}

      <SiteFooter />
    </>
  );
}