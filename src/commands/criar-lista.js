// ============================================================
// criar-lista.js — Comando !criar-lista [Descrição] N{quantidade}
// Gera uma lista numerada para sorteio com todos os números
// vazios, pronta para os membros escolherem seus números.
//
// Uso:
//   !criar-lista [Descrição do sorteio] N150
//   !criar-lista [SORTEIO ESPECIAL] N100
//   !criar-lista [Rifa de Natal] N50
//
// Apenas admins e root podem executar
// ============================================================

export async function comandoCriarLista(msg, sock, fromClean, args) {
  try {
    const jid = msg.key.remoteJid;
    const texto = msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text || "";

    // Extrair a descrição entre colchetes e o número N
    // Formato: !criar-lista [Descrição aqui] N150
    // Ou: !criar-lista [Descrição aqui] 150
    const matchDescricao = texto.match(/\[([^\]]+)\]/);
    const matchNumero = texto.match(/[Nn](\d+)/);

    // Fallback: tentar pegar número sem N no final
    let quantidade = 0;
    if (matchNumero) {
      quantidade = parseInt(matchNumero[1]);
    } else {
      // Tentar pegar o último número no texto
      const nums = texto.match(/(\d+)/g);
      if (nums && nums.length > 0) {
        quantidade = parseInt(nums[nums.length - 1]);
      }
    }

    if (!matchDescricao || quantidade <= 0) {
      return {
        mensagem: `❌ *Formato incorreto!*\n\nUse: *!criar-lista [Descrição do sorteio] N150*\n\nExemplo:\n!criar-lista [SORTEIO ESPECIAL 150 MEMBROS\n\nPrêmios:\n🥇 1º: Box Greninja ex\n🥈 2º: Quadpack Fogo\n🥉 3º: Triple Pack\n\nEscolha seu número!] N150`
      };
    }

    // Limitar quantidade para evitar mensagens muito grandes
    if (quantidade > 500) {
      return {
        mensagem: "⚠️ Máximo de *500 números* por lista. Tente um valor menor."
      };
    }

    if (quantidade < 2) {
      return {
        mensagem: "⚠️ A lista precisa ter pelo menos *2 números*."
      };
    }

    const descricao = matchDescricao[1].trim();

    // Montar a lista
    // Cabeçalho com a descrição entre colchetes (como o usuário espera)
    let lista = `[${descricao}]\n\n`;

    // Gerar números vazios
    for (let i = 1; i <= quantidade; i++) {
      lista += `${i} -\n`;
    }

    // Enviar a lista diretamente (pode ser grande, enviar via sock)
    // WhatsApp tem limite de ~65000 caracteres por mensagem
    // Uma linha "999 -\n" tem ~6 chars, então 500 linhas = ~3000 chars (OK)

    // Para listas muito grandes, dividir em partes
    const LIMITE_CHARS = 4000; // margem segura para WhatsApp

    if (lista.length <= LIMITE_CHARS) {
      await sock.sendMessage(jid, { text: lista });
    } else {
      // Dividir: cabeçalho + blocos de números
      await sock.sendMessage(jid, { text: `[${descricao}]\n` });

      // Dividir os números em blocos
      let bloco = "";
      for (let i = 1; i <= quantidade; i++) {
        const linha = `${i} -\n`;
        if ((bloco + linha).length > LIMITE_CHARS) {
          await sock.sendMessage(jid, { text: bloco });
          await new Promise(r => setTimeout(r, 500)); // delay anti-flood
          bloco = "";
        }
        bloco += linha;
      }
      // Enviar último bloco
      if (bloco) {
        await sock.sendMessage(jid, { text: bloco });
      }
    }

    // Retorna null para não duplicar mensagem pelo brain
    return null;

  } catch (err) {
    console.error("[CRIAR-LISTA] Erro:", err.message);
    return { mensagem: "❌ Erro ao criar a lista." };
  }
}

// ============================================================
// FIM criar-lista.js
// ============================================================
