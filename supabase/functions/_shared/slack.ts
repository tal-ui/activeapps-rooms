// Slack posting — same config source as the CRM's slack-notify (integrations.key='slack').
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface SlackConfig {
  bot_token?: string;
  default_channel?: string;
  channel?: string;
  channels?: Record<string, string>;
  events?: Record<string, boolean>;
  app_url?: string;
}

export async function getSlackConfig(admin: SupabaseClient): Promise<SlackConfig | null> {
  const { data } = await admin.from("integrations").select("connected, config").eq("key", "slack").maybeSingle();
  if (!data || !data.connected) return null;
  const cfg = (data.config ?? {}) as SlackConfig;
  return cfg.bot_token ? cfg : null;
}

export function channelFor(cfg: SlackConfig, kind: string): string {
  return cfg.channels?.[kind] || cfg.default_channel || cfg.channel || "";
}

export function blocksFor(header: string, fields: [string, string][], url: string, buttonText = "Open room") {
  return [
    { type: "header", text: { type: "plain_text", text: header, emoji: true } },
    { type: "section", fields: fields.map(([k, v]) => ({ type: "mrkdwn", text: `*${k}*\n${v}` })) },
    { type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: buttonText }, url, style: "primary" }] },
  ];
}

export async function postSlack(cfg: SlackConfig, kind: string, text: string, blocks: unknown[]): Promise<{ ok: boolean; error?: string }> {
  const channel = channelFor(cfg, kind);
  if (!channel) return { ok: false, error: "no_channel_configured" };
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Bearer ${cfg.bot_token}` },
    body: JSON.stringify({ channel, text, blocks, unfurl_links: false }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: !!(data as { ok?: boolean }).ok, error: (data as { error?: string }).error };
}
