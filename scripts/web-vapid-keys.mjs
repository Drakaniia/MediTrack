#!/usr/bin/env node
/**
 * Generates a VAPID key pair (P-256) for MediTract Web's Web Push and prints it
 * together with the exact commands that install it.
 *
 *   node scripts/web-vapid-keys.mjs
 *
 * Self-contained on purpose (WebCrypto only, no TypeScript or workspace
 * imports) so it runs on a fresh checkout before `pnpm install`. It never
 * writes files: the private key must only ever live in a secret store, not in
 * the repo or a shell history of a shared machine.
 */

const COORDINATE_BYTES = 32;
const POINT_BYTES = 65;

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function generateVapidKeys() {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const publicRaw = new Uint8Array(
    await crypto.subtle.exportKey("raw", pair.publicKey)
  );
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  if (publicRaw.length !== POINT_BYTES || !privateJwk.d) {
    throw new Error("Unexpected key export format");
  }
  const privateKey = privateJwk.d;
  if (Buffer.from(privateKey, "base64url").length !== COORDINATE_BYTES) {
    throw new Error("Unexpected private key length");
  }
  return { privateKey, publicKey: toBase64Url(publicRaw) };
}

const { publicKey, privateKey } = await generateVapidKeys();

const lines = [
  "# MediTract Web VAPID keys (P-256, base64url)",
  "# Keep VAPID_PRIVATE_KEY secret. Do not commit it or write it to a file.",
  "",
  `VAPID_PUBLIC_KEY=${publicKey}`,
  `VAPID_PRIVATE_KEY=${privateKey}`,
  "",
  "# 1. Pages project (apps/web) - API + service worker subscribe",
  "#    The public key is not secret; the private key is.",
  "#    Replace <project> with your Pages project name.",
  "#",
  "#    Secrets (each command prompts for the value; paste it):",
  "#      pnpm exec wrangler pages secret put VAPID_PRIVATE_KEY --project-name <project>",
  "#      pnpm exec wrangler pages secret put VAPID_PUBLIC_KEY --project-name <project>",
  "#    Or set VAPID_PUBLIC_KEY under [vars] in apps/web/wrangler.toml.",
  "#    Also set VAPID_SUBJECT (mailto:you@example.org or an https: URL).",
  "#",
  "# 2. Cron Worker (workers/cron) - sends the push messages",
  "#    From the workers/cron directory:",
  "#      pnpm exec wrangler secret put VAPID_PRIVATE_KEY",
  "#    Public key and subject are plain vars in workers/cron/wrangler.toml [vars]:",
  `#      VAPID_PUBLIC_KEY = "${publicKey}"`,
  '#      VAPID_SUBJECT = "mailto:you@example.org"',
  "#",
  "# The public key MUST be identical in the Pages project and the cron Worker.",
  "# Regenerating keys invalidates every existing browser subscription: users",
  "# have to opt in to notifications again.",
];

process.stdout.write(`${lines.join("\n")}\n`);
