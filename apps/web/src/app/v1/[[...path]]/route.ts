import { app } from "@healthcare/backend/app";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 55;

async function handle(request: Request): Promise<Response> {
  return await app.fetch(request);
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE, handle as OPTIONS };
