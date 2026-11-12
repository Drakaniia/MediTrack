import {
  changePasswordInputSchema,
  loginInputSchema,
} from "../../shared/session";
import { buildClearedSessionCookie, isSecureRequest } from "../auth/session";
import { noContent, ok, parseJson } from "../http";
import type {
  ProtectedRouteContext,
  PublicRouteContext,
  RouteDef,
} from "../route-types";
import {
  buildMeResponse,
  performLogin,
  performLogout,
  performPasswordChange,
} from "../services/platform/auth-service";

/**
 * Sign-in, sign-out, the `me` bootstrap and password change (spec §8.4). Owned by the
 * PLATFORM slice. Everything except login is `allowPasswordChangePending`, so a person who
 * must pick a new password can still reach exactly these routes.
 */

async function login(ctx: PublicRouteContext): Promise<Response> {
  const input = await parseJson(ctx, loginInputSchema);
  const outcome = await performLogin(ctx, input);
  return ok(outcome.me, undefined, {
    headers: { "set-cookie": outcome.cookie },
  });
}

function signedOutResponse(ctx: ProtectedRouteContext): Response {
  const response = noContent();
  response.headers.append(
    "set-cookie",
    buildClearedSessionCookie({ secure: isSecureRequest(ctx.request) })
  );
  return response;
}

async function logout(ctx: ProtectedRouteContext): Promise<Response> {
  await performLogout(ctx, false);
  return signedOutResponse(ctx);
}

async function logoutAll(ctx: ProtectedRouteContext): Promise<Response> {
  await performLogout(ctx, true);
  return signedOutResponse(ctx);
}

async function me(ctx: ProtectedRouteContext): Promise<Response> {
  return ok(await buildMeResponse(ctx.db, ctx.user, ctx.now));
}

async function changePassword(ctx: ProtectedRouteContext): Promise<Response> {
  const input = await parseJson(ctx, changePasswordInputSchema);
  return ok(await performPasswordChange(ctx, input));
}

export const authRoutes: RouteDef[] = [
  {
    access: "public",
    handler: login,
    method: "POST",
    path: "/api/auth/login",
  },
  {
    access: "authenticated",
    allowPasswordChangePending: true,
    handler: logout,
    method: "POST",
    path: "/api/auth/logout",
  },
  {
    access: "authenticated",
    allowPasswordChangePending: true,
    handler: logoutAll,
    method: "POST",
    path: "/api/auth/logout-all",
  },
  {
    access: "authenticated",
    allowPasswordChangePending: true,
    handler: me,
    method: "GET",
    path: "/api/auth/me",
  },
  {
    access: "authenticated",
    allowPasswordChangePending: true,
    handler: changePassword,
    method: "POST",
    path: "/api/auth/change-password",
  },
];
