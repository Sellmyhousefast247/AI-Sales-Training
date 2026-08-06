import { gohighlevel } from "./providers/gohighlevel";
import { smrtphone } from "./providers/smrtphone";
import { wavv } from "./providers/wavv";
import { dialpad } from "./providers/dialpad";
import { aircall } from "./providers/aircall";
import { generic } from "./providers/generic";
import type { ProviderAdapter, WebhookProvider } from "./types";

const ADAPTERS: Record<WebhookProvider, ProviderAdapter> = {
  gohighlevel,
  smrtphone,
  wavv,
  dialpad,
  aircall,
  webhook: generic,
};

export function getAdapter(provider: string): ProviderAdapter | null {
  // Zapier / n8n use the generic contract.
  if (provider === "zapier" || provider === "n8n") return ADAPTERS.webhook;
  return (ADAPTERS as Record<string, ProviderAdapter>)[provider] ?? null;
}

export { WEBHOOK_PROVIDERS } from "./types";
export type { NormalizedInboundCall, ProviderAdapter, WebhookProvider, IntegrationRow } from "./types";
