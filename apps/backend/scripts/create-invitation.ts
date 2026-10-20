import { createInvitation } from "../src/auth/invitations.js";
import { pool } from "@healthcare/database";

const emailIndex = process.argv.indexOf("--email");
const email = emailIndex >= 0 ? process.argv[emailIndex + 1]?.trim() : undefined;
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  throw new Error("Usage: npm run invite:create -- --email friend@example.com");
}

try {
  const code = await createInvitation(email);
  console.log("Invitation created. Share this one-time code privately:");
  console.log(code);
} finally {
  await pool.end();
}
