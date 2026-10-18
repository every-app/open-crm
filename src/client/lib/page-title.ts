// The browser tab's title, as the original CRM titles its pages: the page's
// name, then the product's ("%s · Comp AI CRM" there). The product's name is
// the manifest's (everyapp.config.ts).

/** The tab's title on a page without a name of its own. */
export const PRODUCT_NAME = "CRM";

/** "Companies · CRM": a page's, or an open record's, title in the tab. */
export function pageTitle(name: string): string {
  return `${name} · ${PRODUCT_NAME}`;
}

/** A route's `head`: its page's title in the tab. */
export function pageHead(name: string) {
  return { meta: [{ title: pageTitle(name) }] };
}
