"use strict";

export const config = {
  api: {
    bodyParser: false,
  },
};

const maxBytes = 25 * 1024 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("Audio trop volumineux: limite 25 MB"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function normalizeLanguage(value) {
  if (value === "en") {
    return "en";
  }
  return "fr";
}

function filenameForContentType(contentType) {
  if (contentType.includes("mp4")) {
    return "segment.mp4";
  }
  if (contentType.includes("mpeg")) {
    return "segment.mp3";
  }
  if (contentType.includes("ogg")) {
    return "segment.ogg";
  }
  if (contentType.includes("wav")) {
    return "segment.wav";
  }
  return "segment.webm";
}

function splitDiscordMessage(message) {
  const maxLength = 1800;
  const chunks = [];
  let remaining = message;

  while (remaining.length > maxLength) {
    const splitAt = remaining.lastIndexOf("\n", maxLength);
    const index = splitAt > 200 ? splitAt : maxLength;
    chunks.push(remaining.slice(0, index));
    remaining = remaining.slice(index).trimStart();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
}

async function postToDiscord(text, language) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl || !text.trim()) {
    return;
  }

  const stamp = new Date().toLocaleString("fr-FR", {
    timeZone: "Europe/Paris",
    dateStyle: "short",
    timeStyle: "medium",
  });
  const message = `**Transcription audio** (${language}, ${stamp})\n${text.trim()}`;

  for (const chunk of splitDiscordMessage(message)) {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: chunk,
        allowed_mentions: { parse: [] },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`Discord webhook ${response.status}: ${errorText || "échec d'envoi"}`);
    }
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "OPENAI_API_KEY manquante dans les variables Vercel" });
    return;
  }

  try {
    const audioBuffer = await readBody(req);
    if (!audioBuffer.length) {
      res.status(400).json({ error: "Audio vide" });
      return;
    }

    const contentType = req.headers["content-type"] || "audio/webm";
    const language = normalizeLanguage(req.query.language);
    const audioBlob = new Blob([audioBuffer], { type: contentType });
    const formData = new FormData();
    formData.append("model", process.env.TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe");
    formData.append("file", audioBlob, filenameForContentType(contentType));
    formData.append("language", language);
    formData.append("response_format", "json");

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    });

    const text = await response.text();
    if (!response.ok) {
      res.status(response.status).json({ error: text || "Erreur OpenAI" });
      return;
    }

    const payload = JSON.parse(text);
    const transcription = payload.text || "";
    let discordPosted = false;
    let discordError = null;

    try {
      await postToDiscord(transcription, language);
      discordPosted = Boolean(process.env.DISCORD_WEBHOOK_URL && transcription.trim());
    } catch (error) {
      discordError = error.message || "Erreur Discord";
    }

    res.status(200).json({ text: transcription, discordPosted, discordError });
  } catch (error) {
    res.status(500).json({ error: error.message || "Erreur transcription" });
  }
}
