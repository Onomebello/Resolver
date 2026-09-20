import { parseCookie, stringifySetCookie } from "cookie";
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { platformConfig } from "./config.js";

const SESSION_COOKIE = "resolver_session";
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface SessionPayload {
  userId: string;
}

export function createSessionCookie(payload: SessionPayload): string {
  const token = jwt.sign(payload, platformConfig.sessionSecret, { expiresIn: SESSION_TTL_SECONDS });
  return stringifySetCookie({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: platformConfig.appBaseUrl.startsWith("https://"),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie(): string {
  return stringifySetCookie({ name: SESSION_COOKIE, value: "", httpOnly: true, path: "/", maxAge: 0 });
}

function readSession(req: Request): SessionPayload | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  const token = parseCookie(header)[SESSION_COOKIE];
  if (!token) return undefined;
  try {
    return jwt.verify(token, platformConfig.sessionSecret) as SessionPayload;
  } catch {
    return undefined;
  }
}

export interface AuthenticatedRequest extends Request {
  userId?: string;
}

export function attachSession(req: AuthenticatedRequest, _res: Response, next: NextFunction): void {
  req.userId = readSession(req)?.userId;
  next();
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.userId) {
    res.status(401).json({ error: "Not signed in" });
    return;
  }
  next();
}
