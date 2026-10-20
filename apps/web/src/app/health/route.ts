import { app } from "@healthcare/backend/app";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return await app.fetch(request);
}
