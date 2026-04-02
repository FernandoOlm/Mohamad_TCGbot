// --------------------------------------------------------
// COMANDO !sorteio (Versão Suspense e Historinha)
// --------------------------------------------------------

import { aiGenerateReply_Unique01 } from "../core/aiClient.js";

export async function comandoSorteio(msg, sock) {
  const jid = msg.key.remoteJid;

  const txt =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    "";

  // Número de vencedores
  const qtdMatch = txt.match(/!sorteio\s+(\d+)/i);
  let qtd = qtdMatch ? parseInt(qtdMatch[1]) : 1;

  // Mensagem respondida (a lista)
  const reply =
    msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

  if (!reply) {
    await sock.sendMessage(jid, {
      text: "❗ Responda uma lista no formato:\n1 - Nome\n2 - Nome\n3 - Nome..."
    });
    return;
  }

  const listaTxt =
    reply.conversation ||
    reply.extendedTextMessage?.text ||
    "";

  // --------------------------------------------------------
  // FILTRAR APENAS LINHAS DE PARTICIPANTES
  // Aceita: "1 - Nome", "2- Nome", "3. Nome"
  // --------------------------------------------------------
  const linhas = listaTxt
    .split("\n")
    .map(l => l.trim())
    .filter(l => /^\d+\s*[-.]/.test(l));

  if (linhas.length === 0) {
    await sock.sendMessage(jid, { text: "❗ Nenhum participante válido encontrado." });
    return;
  }

  // --------------------------------------------------------
  // Extrair dados dos participantes
  // --------------------------------------------------------
  const participantes = linhas.map((linha, index) => {
    const pos = index + 1;

    // Extrair @numero
    let mention = linha.match(/@(\d{5,})/);
    if (mention) {
      return { pos, entrada: mention[1], linha: linha.replace(/^\d+\s*[-.]\s*/, "") };
    }

    // Extrair número solto
    let numero = linha.match(/(\d{5,})/);
    if (numero) {
      return { pos, entrada: numero[1], linha: linha.replace(/^\d+\s*[-.]\s*/, "") };
    }

    // Se não achar número, usa o texto puro
    return {
      pos,
      entrada: linha.replace(/^\d+\s*[-.]\s*/, ""),
      linha: linha.replace(/^\d+\s*[-.]\s*/, "")
    };
  });

  // --------------------------------------------------------
  // SORTEIO
  // --------------------------------------------------------
  function sortearUm() {
    const i = Math.floor(Math.random() * participantes.length);
    return participantes[i];
  }

  if (qtd > participantes.length) qtd = participantes.length;

  let usados = new Set();
  let vencedores = [];

  while (vencedores.length < qtd) {
    let v = sortearUm();
    if (!usados.has(v.pos)) {
      usados.add(v.pos);
      vencedores.push(v);
    }
  }

  // --------------------------------------------------------
  // MONTAR RESPOSTA COM SUSPENSE E HISTORINHA
  // --------------------------------------------------------

  // Mensagem 1: Início do suspense
  await sock.sendMessage(jid, { text: "⏳ Atenção, atenção, participantes do sorteio! O momento da verdade se aproxima..." });
  await new Promise(resolve => setTimeout(resolve, 3000)); // Espera 3 segundos

  // Mensagem 2: Mais suspense
  await sock.sendMessage(jid, { text: `Com ${participantes.length} bravos concorrentes e ${qtd} prêmio(s) em jogo, a tensão é palpável!` });
  await new Promise(resolve => setTimeout(resolve, 3000)); // Espera 3 segundos

  // Mensagem 3: Redemoinho de nomes
  await sock.sendMessage(jid, { text: "Os nomes estão girando, girando... Quem será o grande sortudo (ou sortudos)?!" });
  await new Promise(resolve => setTimeout(resolve, 4000)); // Espera 4 segundos

  // Mensagem 4: O grande anúncio
  let msgFinal = `🎉 *E OS VENCEDORES SÃO...* 🎉\n\n`;
  msgFinal += `Quantidade sorteada: *${qtd}*\n`;
  msgFinal += `Participantes válidos: *${participantes.length}*\n\n`;
  msgFinal += `🏆 *PARABÉNS AOS CAMPEÕES:* 🏆\n`;

  vencedores.forEach(v => {
    msgFinal += `• Nº *${v.pos}* → ${v.linha}\n`;
  });

  await sock.sendMessage(jid, { text: msgFinal });

  // Mensagem 5: Encerramento
  await new Promise(resolve => setTimeout(resolve, 2000)); // Espera 2 segundos
  await sock.sendMessage(jid, { text: "Obrigado a todos por participarem! Fiquem ligados para os próximos sorteios!" });
}

// --------------------------------------------------------
// FIM do comando !sorteio
// --------------------------------------------------------
