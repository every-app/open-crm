import { resolveUserContextFromHeaders } from "@/middleware/ensure-user/resolve";
import { ChatShareService } from "@/server/features/sharing/services/ChatShareService";
import { BuilderService } from "../services/BuilderService";

// A file attached in a builder chat, served to the person whose chat it is
// (`/api/agent-attachments/<id>`), or with `?share=<token>` to anyone the
// chat's live link opens it for. Anyone else gets the same 404 as a missing
// file. Images open in place; everything else downloads.

export const ATTACHMENT_ROUTE_PREFIX = "/api/agent-attachments/";

const PREVIEWABLE = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export async function serveAttachment(request: Request): Promise<Response> {
  if (request.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }
  const url = new URL(request.url);
  const id = decodeURIComponent(
    url.pathname.slice(ATTACHMENT_ROUTE_PREFIX.length),
  );
  const share = url.searchParams.get("share");
  let context;
  try {
    context = await resolveUserContextFromHeaders(request.headers);
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }
  const found = !id
    ? null
    : share
      ? await ChatShareService.attachment(context, share, id)
      : await BuilderService.attachmentObject(context, id);
  if (!found) return new Response("Not found", { status: 404 });
  const { row, object } = found;
  const inline = PREVIEWABLE.has(row.mediaType.toLowerCase());
  return new Response(object.body, {
    headers: {
      "content-type": inline ? row.mediaType : "application/octet-stream",
      "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(row.name)}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
}
