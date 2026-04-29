/**
 * Server-side reverse proxy: forwards all /api/proxy/** requests to the private
 * backend Cloud Run service, attaching a GCP OIDC identity token so the backend
 * can be kept fully private (no allUsers IAM policy needed).
 *
 * In local development (no metadata server), the GCP token fetch is skipped and
 * requests are forwarded without an identity token — the backend localhost needs
 * no IAM auth anyway.
 */

import { type NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";

/** Fetch a GCP OIDC identity token from the metadata server (Cloud Run only). */
async function getIdentityToken(audience: string): Promise<string | null> {
  try {
    const url =
      `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity` +
      `?audience=${encodeURIComponent(audience)}&format=full`;
    const res = await fetch(url, {
      headers: { "Metadata-Flavor": "Google" },
      // Short timeout — if we're not on GCP this will fail fast
      signal: AbortSignal.timeout(1000),
    });
    if (!res.ok) return null;
    return res.text();
  } catch {
    // Not running on GCP (local dev) — skip token
    return null;
  }
}

async function handler(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const upstreamPath = "/" + path.join("/");
  const search = req.nextUrl.search;
  const upstreamUrl = `${BACKEND_URL}${upstreamPath}${search}`;

  // Only attempt identity token when running on Cloud Run (BACKEND_URL is not localhost)
  let identityToken: string | null = null;
  if (!BACKEND_URL.includes("localhost")) {
    identityToken = await getIdentityToken(BACKEND_URL);
  }

  // Forward all original headers except host (which fetch sets automatically)
  const forwardedHeaders = new Headers(req.headers);
  forwardedHeaders.delete("host");
  forwardedHeaders.delete("connection");
  forwardedHeaders.delete("transfer-encoding");

  if (identityToken) {
    // The GCP identity token authenticates the frontend SA to the backend Cloud Run service.
    // The original Authorization header (Clerk JWT) is preserved in a separate header so
    // the backend middleware can still authenticate the end-user.
    const clerkToken = forwardedHeaders.get("authorization");
    if (clerkToken) {
      forwardedHeaders.set("x-forwarded-authorization", clerkToken);
    }
    forwardedHeaders.set("authorization", `Bearer ${identityToken}`);
  }

  const hasBody = req.method !== "GET" && req.method !== "HEAD";

  const upstreamRes = await fetch(upstreamUrl, {
    method: req.method,
    headers: forwardedHeaders,
    body: hasBody ? req.body : undefined,
    // Required so Next.js doesn't buffer the request body before forwarding
    // @ts-expect-error — duplex is required for streaming request bodies in Node fetch
    duplex: "half",
  });

  // Stream the response back as-is (important for SSE/streaming chat)
  const responseHeaders = new Headers(upstreamRes.headers);
  // Remove hop-by-hop headers
  responseHeaders.delete("transfer-encoding");
  responseHeaders.delete("connection");

  return new NextResponse(upstreamRes.body, {
    status: upstreamRes.status,
    headers: responseHeaders,
  });
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const HEAD = handler;
export const OPTIONS = handler;
