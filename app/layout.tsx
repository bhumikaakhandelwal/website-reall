import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { GlobalNavigation } from "./components/global-navigation";
import { SiteFooter } from "./components/site-footer";
import "./globals.css";
import LoginGate from "./components/login-gate";
import InaugurationIntro from "./components/inauguration-intro";
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "DBCE Coders Club | Official Website",
    template: "%s | DBCE Coders Club",
  },
  description:
    "The official website of DBCE Coders Club at Don Bosco College of Engineering.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} antialiased`}
    >
      <body>
        <LoginGate>
        <InaugurationIntro>
        <a
          href="#main-content"
          className="sr-only fixed left-page top-4 z-50 rounded-card bg-foreground px-4 py-2 text-sm font-medium text-background focus:not-sr-only"
        >
          Skip to main content
        </a>
        
        
        {children}
        
        </InaugurationIntro>
        </LoginGate>
      </body>
    </html>
  );
}
