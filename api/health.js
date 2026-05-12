"use strict";

export default function handler(req, res) {
  res.status(200).json({
    ok: true,
    openaiKeyConfigured: Boolean(process.env.OPENAI_API_KEY),
    discordWebhookConfigured: Boolean(process.env.DISCORD_WEBHOOK_URL),
    model: process.env.TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe",
  });
}
