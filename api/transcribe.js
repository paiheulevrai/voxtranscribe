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
    formData.append("file", audioBlob, "segment.webm");
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
    res.status(200).json({ text: payload.text || "" });
  } catch (error) {
    res.status(500).json({ error: error.message || "Erreur transcription" });
  }
}
