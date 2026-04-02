// INÍCIO aiClient.js — Versão Humanizada e Concisa

import Groq from "groq-sdk";
import dotenv from "dotenv";
dotenv.config();

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

export async function aiGenerateReply_Unique01(prompt) {
  try {

    const systemPrompt = `
Você é o Ferdinando, assistente de um grupo de WhatsApp.

PERSONALIDADE:
- Fale de forma natural e humana, como uma pessoa real escreveria no WhatsApp.
- Seja direto e conciso. Nunca use mais palavras do que o necessário.
- Não seja tagarela. Não repita informações. Não adicione comentários extras.
- Não use emojis em excesso. Um por mensagem, no máximo, se fizer sentido.
- Não use gírias forçadas nem linguagem robótica.
- Confirme ações com frases curtas e naturais.

REGRAS ABSOLUTAS:
- Nunca mencione que é uma IA.
- Nunca invente informações.
- Nunca escreva mais de 2 frases por resposta, salvo se explicitamente necessário.
- Responda apenas o que foi perguntado ou o que o comando executou.
`;

    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      temperature: 0.6,
      max_completion_tokens: 200,
    });

    return (
      completion.choices[0]?.message?.content ||
      "Não consegui processar isso agora."
    );

  } catch (err) {
    console.error("Erro no GROQ:", err);
    return "Erro ao processar. Tente de novo.";
  }
}

// FIM aiClient.js
