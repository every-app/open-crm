import { eq } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schema";

// The gateway's people are stored in the `user` table, keyed by the gateway's
// `sub`, so every CRM table that references a person (owners, authors,
// deciders) resolves the same way. Only the email ever changes here.
function deriveUserName(email: string) {
  return email.split("@")[0] || "CRM";
}

export async function ensureUserRecord(userId: string, userEmail: string) {
  const existing = await db.query.user.findFirst({
    columns: { email: true },
    where: eq(user.id, userId),
  });

  if (!existing) {
    // Concurrent first-load requests can all see "no row" and race to insert
    // the same id; onConflictDoNothing on the PK makes the losers no-ops instead
    // of failing. Scoped to the id so a genuine email-unique collision (two
    // distinct ids sharing an email) still surfaces loudly.
    await db
      .insert(user)
      .values({
        id: userId,
        name: deriveUserName(userEmail),
        email: userEmail,
        emailVerified: true,
      })
      .onConflictDoNothing({ target: user.id });

    return userEmail;
  }

  if (existing.email !== userEmail) {
    await db
      .update(user)
      .set({ email: userEmail, name: deriveUserName(userEmail) })
      .where(eq(user.id, userId));

    return userEmail;
  }

  return existing.email;
}
