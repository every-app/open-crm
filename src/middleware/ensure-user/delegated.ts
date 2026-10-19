import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import { user } from "@/db/schema";

// The gateway's people are stored in the `user` table, keyed by the gateway's
// `sub`, so every CRM table that references a person (owners, authors,
// deciders) resolves the same way. Only the email ever changes here.
//
// An email is one gateway account's at a time. The gateway deletes the
// account of a member it removes from their last organization, so inviting
// them again brings them back under a new id with the same email: the old
// row keeps the records it is on and gives the address up, in the batch
// that writes it onto the new one, so the unique email never locks them out.
function deriveUserName(email: string) {
  return email.split("@")[0] || "CRM";
}

export async function ensureUserRecord(userId: string, userEmail: string) {
  const existing = await db.query.user.findFirst({
    columns: { email: true },
    where: eq(user.id, userId),
  });
  if (existing?.email === userEmail) return userEmail;

  await runBatch((tx) => [
    tx
      .update(user)
      // An address nobody sends from, unique to the row giving it up.
      .set({ email: sql<string>`${user.id} || '@replaced.invalid'` })
      .where(and(eq(user.email, userEmail), ne(user.id, userId))),
    existing
      ? tx
          .update(user)
          .set({ email: userEmail, name: deriveUserName(userEmail) })
          .where(eq(user.id, userId))
      : // Concurrent first-load requests can all see "no row" and race to
        // insert the same row. Every unique index is an arbiter, so the
        // losers are no-ops on either one.
        tx
          .insert(user)
          .values({
            id: userId,
            name: deriveUserName(userEmail),
            email: userEmail,
            emailVerified: true,
          })
          .onConflictDoNothing(),
  ]);
  return userEmail;
}
