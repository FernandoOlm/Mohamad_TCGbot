// ============================================================
// criar-rifa.js — Comando !criar-rifa [Descrição] N{quantidade}
// (Antigo !criar-lista — renomeado para evitar conflito)
// Gera uma lista numerada para sorteio com todos os números
// vazios, pronta para os membros escolherem seus números.
//
// Uso:
//   !criar-rifa [Descrição do sorteio] N150
//   !criar-rifa [SORTEIO ESPECIAL] N100
//   !criar-rifa [Rifa de Natal] N50
//
// Apenas admins e root podem executar
// ============================================================

export async function comandoCriarRifa(msg, sock, fromClean, args) {
  try {
    const jid = msg.key.remoteJid;
    const texto = msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text || "";

    // Extrair a descrição entre colchetes e o número N
    const matchDescricao = texto.match(/\[([^\]]+)\]/);
    const matchNumero = texto.match(/[Nn](\d+)/);

    let quantidade = 0;
    if (matchNumero) {
      quantidade = parseInt(matchNumero[1]);
    } else {
      const nums = texto.match(/(\d+)/g);
      if (nums && nums.length > 0) {
        quantidade = parseInt(nums[nums.length - 1]);
      }
    }

    if (!matchDescricao || quantidade <= 0) {
      return {
        mensagem: `❌ *Formato incorreto!*\n\nUse: *!criar-rifa [Descrição do sorteio] N150*\n\nExemplo:\n!criar-rifa [SORTEIO ESPECIAL 150 MEMBROS\n\nPrêmios:\n🥇 1º: Box Greninja ex\n🥈 2º: Quadpack Fogo\n🥉 3º: Triple Pack\n\nEscolha seu número!] N150`
      };
    }

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

    let lista = `[${descricao}]\n\n`;
    for (let i = 1; i <= quantidade; i++) {
      lista += `${i} -\n`;
    }

    const LIMITE_CHARS = 4000;

    if (lista.length <= LIMITE_CHARS) {
      await sock.sendMessage(jid, { text: lista });
    } else {
      await sock.sendMessage(jid, { text: `[${descricao}]\n` });

      let bloco = "";
      for (let i = 1; i <= quantidade; i++) {
        const linha = `${i} -\n`;
        if ((bloco + linha).length > LIMITE_CHARS) {
          await sock.sendMessage(jid, { text: bloco });
          await new Promise(r => setTimeout(r, 500));
          bloco = "";
        }
        bloco += linha;
      }
      if (bloco) {
        await sock.sendMessage(jid, { text: bloco });
      }
    }

    return null;

  } catch (err) {
    console.error("[CRIAR-RIFA] Erro:", err.message);
    return { mensagem: "❌ Erro ao criar a rifa." };
  }
}

// ============================================================
// FIM criar-rifa.js
// ============================================================
