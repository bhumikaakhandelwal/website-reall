// Minimal application session for Phase 1C approved-email login.
//
// This is deliberately NOT Supabase Auth. An approved-email login does not
// create a Supabase Auth user or session, so the application keeps its own
// small, self-contained session: a signed HTTP-only cookie that carries only
// the member's id and an expiry timestamp.
//
// SECURITY TRADEOFF (intentional, see docs/BACKEND-IMPLEMENTATION-PLAN.md):
// knowing an approved email address is sufficient to log in. There is no
// password, OTP, magic link, or email verification. The session cookie is only
// as trustworthy as that allowance.
//
// The cookie is signed with SESSION_SECRET (HMAC-SHA256). No new dependency is
// required — node:crypto is used directly.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';

export const SESSION_COOKIE_NAME = 'dbce_session';

// Sessions live for 7 days. Session timeout duration is otherwise undefined.
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

type SessionPayload = {
  memberId: string;
  expiresAt: number; // unix seconds
};

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;

  if (!secret) {
    throw new Error(
      'SESSION_SECRET is not set — cannot sign or verify member sessions'
    );
  }

  return secret;
}

function sign(body: string): string {
  return createHmac('sha256', getSecret()).update(body).digest('base64url');
}

function encodeSession(payload: SessionPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body)}`;
}

// Returns the decoded payload only if the signature is valid and unexpired.
function decodeSession(token: string): SessionPayload | null {
  const [body, signature] = token.split('.');

  if (!body || !signature) return null;

  // Constant-time signature comparison.
  const expected = Buffer.from(sign(body));
  const provided = Buffer.from(signature);

  if (
    expected.length !== provided.length ||
    !timingSafeEqual(expected, provided)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(body, 'base64url').toString('utf8')
    ) as Partial<SessionPayload>;

    if (
      typeof payload.memberId !== 'string' ||
      typeof payload.expiresAt !== 'number' ||
      payload.expiresAt <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }

    return { memberId: payload.memberId, expiresAt: payload.expiresAt };
  } catch {
    return null;
  }
}

// Creates the session cookie. Server-side only; the value is never exposed to
// client-side JavaScript.
export async function createSession(memberId: string): Promise<void> {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const cookieStore = await cookies();

  cookieStore.set(SESSION_COOKIE_NAME, encodeSession({ memberId, expiresAt }), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}

// Verifies the session server-side and returns the member id, or null.
export async function getSessionMemberId(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!token) return null;

  const payload = decodeSession(token);

  return payload ? payload.memberId : null;
}

// Clears the session cookie on logout.
export async function clearSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}
