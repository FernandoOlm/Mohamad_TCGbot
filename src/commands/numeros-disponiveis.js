// ============================================================
// numeros-disponiveis.js — Analisa lista de sorteio e retorna
// os números ainda disponíveis (sem nome após o traço)
// Uso: !numeros-disponiveis (respondendo a lista)
// ============================================================

export async function numerosDisponiveis(msg, sock, fromClean, args) {
  try {
    // Pega o texto da mensagem citada (quoted/reply)
    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const textoLista =
      quoted?.conversation ||
      quoted?.extendedTextMessage?.text ||
      quoted?.imageMessage?.caption ||
      null;

    if (!textoLista) {
      return {
        texto: "❌ Responda a mensagem com a lista de sorteio usando *!numeros-disponiveis*"
      };
    }

    const linhas = textoLista.split("\n");
    const disponiveis = [];
    const ocupados = [];

    for (const linha of linhas) {
      // Detecta padrão: número seguido de espaço/traço
      // Ex: "3 -", "3-", "14 -  ", "14 - Fernando"
      const match = linha.match(/^\s*(\d+)\s*[-–]\s*(.*)$/);
      if (!match) continue;

      const numero = parseInt(match[1]);
      const nome = match[2].trim();

      if (nome === "" || nome === "-") {
        disponiveis.push(numero);
      } else {
        ocupados.push(numero);
      }
    }

    if (disponiveis.length === 0 && ocupados.length === 0) {
      return { texto: "⚠️ Não encontrei nenhuma lista de números na mensagem citada." };
    }

    if (disponiveis.length === 0) {
      return { texto: `✅ Todos os *${ocupados.length}* números já estão ocupados!` };
    }

    // Formata os disponíveis em grupos de 10 por linha para facilitar leitura
    const grupos = [];
    for (let i = 0; i < disponiveis.length; i += 10) {
      grupos.push(disponiveis.slice(i, i + 10).join("  "));
    }

    const total = disponiveis.length + ocupados.length;
    const resposta =
      `🎯 *Números disponíveis* (${disponiveis.length} de ${total})\n\n` +
      grupos.join("\n");

    return { texto: resposta };

  } catch (err) {
    console.error("[NUMEROS-DISPONIVEIS] Erro:", err.message);
    return { texto: "❌ Erro ao processar a lista." };
  }
}
