// ============================================================
// test_listas.js — Testes unitários para o sistema de listas de transmissão
// ============================================================

import fs from "fs";
import path from "path";

const LISTAS_PATH = path.resolve("src/data/listas_transmissao.json");
const AUTH_PATH = path.resolve("src/data/auth/allowed.json");

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  ✅ ${msg}`);
    passed++;
  } else {
    console.log(`  ❌ FALHOU: ${msg}`);
    failed++;
  }
}

// Mock do sock
function createMockSock(grupos = {}) {
  const mensagens = [];
  return {
    mensagens,
    groupFetchAllParticipating: async () => grupos,
    groupMetadata: async (jid) => {
      if (grupos[jid]) return grupos[jid];
      throw new Error("Grupo não encontrado");
    },
    sendMessage: async (jid, content) => {
      mensagens.push({ jid, content });
    },
    user: { id: "5511999999999@s.whatsapp.net" }
  };
}

// Mock de msg
function createMockMsg(texto, fromClean, isGroup = false, jid = null) {
  return {
    key: {
      remoteJid: jid || (isGroup ? "120363423975280243@g.us" : `${fromClean}@s.whatsapp.net`),
      participant: isGroup ? `${fromClean}@s.whatsapp.net` : undefined,
      fromMe: false
    },
    message: {
      conversation: texto
    },
    pushName: "Teste"
  };
}

// Resetar dados antes de cada teste
function resetData() {
  fs.writeFileSync(LISTAS_PATH, JSON.stringify({}, null, 2));
}

// Salvar e restaurar auth
let originalAuth;
function backupAuth() {
  if (fs.existsSync(AUTH_PATH)) {
    originalAuth = fs.readFileSync(AUTH_PATH, "utf8");
  }
}
function restoreAuth() {
  if (originalAuth) {
    fs.writeFileSync(AUTH_PATH, originalAuth);
  }
}

// ============================================================
// TESTES
// ============================================================
async function runTests() {
  console.log("═══════════════════════════════════════════");
  console.log("   TESTES: SISTEMA DE LISTAS DE TRANSMISSÃO");
  console.log("═══════════════════════════════════════════\n");

  backupAuth();

  // Importar módulo
  const {
    comandoListarGrupos,
    comandoCriarListaTransmissao,
    comandoVerListas,
    comandoEnviarLista,
    comandoEditarLista,
    comandoApagarLista
  } = await import("./src/commands/lista-transmissao.js");

  // Definir ROOT para testes
  process.env.ROOT_ID = "65060886032554";

  // Grupos mock do bot
  const gruposMock = {
    "120363423975280243@g.us": {
      id: "120363423975280243@g.us",
      subject: "Testes",
      participants: [{ id: "1@s.whatsapp.net" }, { id: "2@s.whatsapp.net" }]
    },
    "120363425663755197@g.us": {
      id: "120363425663755197@g.us",
      subject: "Teste Ferdinando",
      participants: [{ id: "1@s.whatsapp.net" }]
    },
    "120363402792383817@g.us": {
      id: "120363402792383817@g.us",
      subject: "KAIZEN TCG",
      participants: [{ id: "1@s.whatsapp.net" }, { id: "2@s.whatsapp.net" }, { id: "3@s.whatsapp.net" }]
    }
  };

  // ============================================================
  // TESTE 1: Bloquear comandos em grupo
  // ============================================================
  console.log("📋 TESTE 1: Bloquear comandos em grupo");
  console.log("─────────────────────────────────");
  resetData();
  {
    const sock = createMockSock(gruposMock);
    const msg = createMockMsg("!listar-grupos", "65060886032554", true);
    await comandoListarGrupos(msg, sock, "65060886032554", []);
    assert(sock.mensagens.length === 1, "Enviou mensagem de erro");
    assert(sock.mensagens[0].content.text.includes("PV"), "Mensagem menciona PV");
  }

  // ============================================================
  // TESTE 2: Bloquear usuário não autorizado
  // ============================================================
  console.log("\n📋 TESTE 2: Bloquear usuário não autorizado");
  console.log("─────────────────────────────────");
  resetData();
  {
    const sock = createMockSock(gruposMock);
    const msg = createMockMsg("!listar-grupos", "99999999999999", false);
    await comandoListarGrupos(msg, sock, "99999999999999", []);
    assert(sock.mensagens.length === 1, "Enviou mensagem de erro");
    assert(sock.mensagens[0].content.text.includes("permissão"), "Mensagem menciona permissão");
  }

  // ============================================================
  // TESTE 3: Listar grupos (ROOT autorizado)
  // ============================================================
  console.log("\n📋 TESTE 3: Listar grupos (ROOT autorizado)");
  console.log("─────────────────────────────────");
  resetData();
  {
    const sock = createMockSock(gruposMock);
    const msg = createMockMsg("!listar-grupos", "65060886032554", false);
    await comandoListarGrupos(msg, sock, "65060886032554", []);
    assert(sock.mensagens.length >= 1, "Enviou lista de grupos");
    const textoEnviado = sock.mensagens.map(m => m.content.text).join("\n");
    assert(textoEnviado.includes("Testes"), "Lista contém grupo Testes");
    assert(textoEnviado.includes("KAIZEN TCG"), "Lista contém grupo KAIZEN TCG");
    assert(textoEnviado.includes("3 grupos"), "Mostra total de 3 grupos");
  }

  // ============================================================
  // TESTE 4: Criar lista de transmissão
  // ============================================================
  console.log("\n📋 TESTE 4: Criar lista de transmissão");
  console.log("─────────────────────────────────");
  resetData();
  {
    const sock = createMockSock(gruposMock);
    const msg = createMockMsg(
      "!criar-lista parceiros 120363423975280243@g.us 120363402792383817@g.us",
      "65060886032554", false
    );
    await comandoCriarListaTransmissao(msg, sock, "65060886032554", []);

    const db = JSON.parse(fs.readFileSync(LISTAS_PATH, "utf8"));
    const userId = "65060886032554";
    assert(db[userId] !== undefined, "Usuário criado no banco");
    assert(db[userId]["parceiros"] !== undefined, "Lista 'parceiros' criada");
    assert(db[userId]["parceiros"].grupos.length === 2, "Lista tem 2 grupos");
    assert(db[userId]["parceiros"].grupos[0].nome === "Testes", "Primeiro grupo é Testes");
    assert(db[userId]["parceiros"].grupos[1].nome === "KAIZEN TCG", "Segundo grupo é KAIZEN TCG");

    const textoEnviado = sock.mensagens.map(m => m.content.text).join("\n");
    assert(textoEnviado.includes("sucesso"), "Mensagem de sucesso enviada");
  }

  // ============================================================
  // TESTE 5: Criar lista com IDs inválidos
  // ============================================================
  console.log("\n📋 TESTE 5: Criar lista com IDs inválidos");
  console.log("─────────────────────────────────");
  resetData();
  {
    const sock = createMockSock(gruposMock);
    const msg = createMockMsg(
      "!criar-lista teste 120363423975280243@g.us 999999999999@g.us",
      "65060886032554", false
    );
    await comandoCriarListaTransmissao(msg, sock, "65060886032554", []);

    const db = JSON.parse(fs.readFileSync(LISTAS_PATH, "utf8"));
    assert(db["65060886032554"]["teste"].grupos.length === 1, "Apenas 1 grupo válido salvo");

    const textoEnviado = sock.mensagens.map(m => m.content.text).join("\n");
    assert(textoEnviado.includes("não encontrados"), "Aviso sobre IDs inválidos");
  }

  // ============================================================
  // TESTE 6: Criar lista sem argumentos suficientes
  // ============================================================
  console.log("\n📋 TESTE 6: Criar lista sem argumentos suficientes");
  console.log("─────────────────────────────────");
  resetData();
  {
    const sock = createMockSock(gruposMock);
    const msg = createMockMsg("!criar-lista", "65060886032554", false);
    await comandoCriarListaTransmissao(msg, sock, "65060886032554", []);
    assert(sock.mensagens[0].content.text.includes("Formato incorreto"), "Mostra erro de formato");
  }

  // ============================================================
  // TESTE 7: Ver listas (sem listas)
  // ============================================================
  console.log("\n📋 TESTE 7: Ver listas (sem listas)");
  console.log("─────────────────────────────────");
  resetData();
  {
    const sock = createMockSock(gruposMock);
    const msg = createMockMsg("!ver-listas", "65060886032554", false);
    await comandoVerListas(msg, sock, "65060886032554", []);
    assert(sock.mensagens[0].content.text.includes("nenhuma lista"), "Mostra que não tem listas");
  }

  // ============================================================
  // TESTE 8: Ver listas (com listas)
  // ============================================================
  console.log("\n📋 TESTE 8: Ver listas (com listas)");
  console.log("─────────────────────────────────");
  resetData();
  {
    // Criar uma lista primeiro
    const db = {
      "65060886032554": {
        "parceiros": {
          nome: "parceiros",
          grupos: [
            { id: "120363423975280243@g.us", nome: "Testes" },
            { id: "120363402792383817@g.us", nome: "KAIZEN TCG" }
          ],
          criadoEm: new Date().toISOString(),
          atualizadoEm: new Date().toISOString()
        }
      }
    };
    fs.writeFileSync(LISTAS_PATH, JSON.stringify(db, null, 2));

    const sock = createMockSock(gruposMock);
    const msg = createMockMsg("!ver-listas", "65060886032554", false);
    await comandoVerListas(msg, sock, "65060886032554", []);

    const textoEnviado = sock.mensagens.map(m => m.content.text).join("\n");
    assert(textoEnviado.includes("parceiros"), "Mostra nome da lista");
    assert(textoEnviado.includes("2 grupo(s)"), "Mostra quantidade de grupos");
    assert(textoEnviado.includes("Testes"), "Mostra nome do grupo");
  }

  // ============================================================
  // TESTE 9: Enviar para lista
  // ============================================================
  console.log("\n📋 TESTE 9: Enviar para lista");
  console.log("─────────────────────────────────");
  resetData();
  {
    const db = {
      "65060886032554": {
        "parceiros": {
          nome: "parceiros",
          grupos: [
            { id: "120363423975280243@g.us", nome: "Testes" },
            { id: "120363402792383817@g.us", nome: "KAIZEN TCG" }
          ],
          criadoEm: new Date().toISOString(),
          atualizadoEm: new Date().toISOString()
        }
      }
    };
    fs.writeFileSync(LISTAS_PATH, JSON.stringify(db, null, 2));

    const sock = createMockSock(gruposMock);
    const msg = createMockMsg(
      "!enviar-lista parceiros | 🔥 Promoção especial no grupo!",
      "65060886032554", false
    );
    await comandoEnviarLista(msg, sock, "65060886032554", []);

    // Deve ter: 1 confirmação + 2 envios para grupos + 1 relatório = 4 mensagens
    assert(sock.mensagens.length === 4, `Enviou 4 mensagens (${sock.mensagens.length})`);
    assert(sock.mensagens[0].content.text.includes("Enviando"), "Primeira msg é confirmação");
    assert(sock.mensagens[1].jid === "120363423975280243@g.us", "Enviou para grupo 1");
    assert(sock.mensagens[1].content.text.includes("Promoção"), "Conteúdo correto no grupo 1");
    assert(sock.mensagens[2].jid === "120363402792383817@g.us", "Enviou para grupo 2");
    assert(sock.mensagens[3].content.text.includes("RELATÓRIO"), "Última msg é relatório");
    assert(sock.mensagens[3].content.text.includes("2/2"), "Relatório mostra 2/2 enviados");
  }

  // ============================================================
  // TESTE 10: Enviar sem separador |
  // ============================================================
  console.log("\n📋 TESTE 10: Enviar sem separador |");
  console.log("─────────────────────────────────");
  resetData();
  {
    const sock = createMockSock(gruposMock);
    const msg = createMockMsg(
      "!enviar-lista parceiros mensagem sem separador",
      "65060886032554", false
    );
    await comandoEnviarLista(msg, sock, "65060886032554", []);
    assert(sock.mensagens[0].content.text.includes("Formato incorreto"), "Mostra erro de formato");
  }

  // ============================================================
  // TESTE 11: Enviar para lista inexistente
  // ============================================================
  console.log("\n📋 TESTE 11: Enviar para lista inexistente");
  console.log("─────────────────────────────────");
  resetData();
  {
    const sock = createMockSock(gruposMock);
    const msg = createMockMsg(
      "!enviar-lista naoexiste | mensagem",
      "65060886032554", false
    );
    await comandoEnviarLista(msg, sock, "65060886032554", []);
    assert(sock.mensagens[0].content.text.includes("não encontrada"), "Mostra lista não encontrada");
  }

  // ============================================================
  // TESTE 12: Editar lista (adicionar e remover)
  // ============================================================
  console.log("\n📋 TESTE 12: Editar lista (adicionar e remover)");
  console.log("─────────────────────────────────");
  resetData();
  {
    const db = {
      "65060886032554": {
        "parceiros": {
          nome: "parceiros",
          grupos: [
            { id: "120363423975280243@g.us", nome: "Testes" }
          ],
          criadoEm: new Date().toISOString(),
          atualizadoEm: new Date().toISOString()
        }
      }
    };
    fs.writeFileSync(LISTAS_PATH, JSON.stringify(db, null, 2));

    const sock = createMockSock(gruposMock);
    const msg = createMockMsg(
      "!editar-lista parceiros +120363402792383817@g.us -120363423975280243@g.us",
      "65060886032554", false
    );
    await comandoEditarLista(msg, sock, "65060886032554", []);

    const dbAtualizado = JSON.parse(fs.readFileSync(LISTAS_PATH, "utf8"));
    const lista = dbAtualizado["65060886032554"]["parceiros"];
    assert(lista.grupos.length === 1, "Lista tem 1 grupo após edição");
    assert(lista.grupos[0].id === "120363402792383817@g.us", "Grupo correto após edição");

    const textoEnviado = sock.mensagens.map(m => m.content.text).join("\n");
    assert(textoEnviado.includes("Adicionados"), "Mostra adicionados");
    assert(textoEnviado.includes("Removidos"), "Mostra removidos");
  }

  // ============================================================
  // TESTE 13: Apagar lista
  // ============================================================
  console.log("\n📋 TESTE 13: Apagar lista");
  console.log("─────────────────────────────────");
  resetData();
  {
    const db = {
      "65060886032554": {
        "parceiros": {
          nome: "parceiros",
          grupos: [
            { id: "120363423975280243@g.us", nome: "Testes" }
          ],
          criadoEm: new Date().toISOString(),
          atualizadoEm: new Date().toISOString()
        }
      }
    };
    fs.writeFileSync(LISTAS_PATH, JSON.stringify(db, null, 2));

    const sock = createMockSock(gruposMock);
    const msg = createMockMsg("!apagar-lista parceiros", "65060886032554", false);
    await comandoApagarLista(msg, sock, "65060886032554", []);

    const dbAtualizado = JSON.parse(fs.readFileSync(LISTAS_PATH, "utf8"));
    assert(dbAtualizado["65060886032554"] === undefined, "Usuário removido do banco (sem listas)");

    const textoEnviado = sock.mensagens.map(m => m.content.text).join("\n");
    assert(textoEnviado.includes("removida"), "Mensagem de remoção enviada");
  }

  // ============================================================
  // TESTE 14: Criar lista sem @g.us (aceita IDs puros)
  // ============================================================
  console.log("\n📋 TESTE 14: Criar lista com IDs sem @g.us");
  console.log("─────────────────────────────────");
  resetData();
  {
    const sock = createMockSock(gruposMock);
    const msg = createMockMsg(
      "!criar-lista minha-lista 120363423975280243 120363402792383817",
      "65060886032554", false
    );
    await comandoCriarListaTransmissao(msg, sock, "65060886032554", []);

    const db = JSON.parse(fs.readFileSync(LISTAS_PATH, "utf8"));
    assert(db["65060886032554"]["minha-lista"].grupos.length === 2, "Aceita IDs sem @g.us");
  }

  // ============================================================
  // TESTE 15: Usuário autorizado em grupo (não ROOT)
  // ============================================================
  console.log("\n📋 TESTE 15: Usuário autorizado em grupo (não ROOT)");
  console.log("─────────────────────────────────");
  resetData();
  {
    // O ID 63755148890155 está autorizado no grupo 120363425663755197@g.us
    const sock = createMockSock(gruposMock);
    const msg = createMockMsg("!ver-listas", "63755148890155", false);
    await comandoVerListas(msg, sock, "63755148890155", []);
    // Deve funcionar (não deve dar erro de permissão)
    assert(sock.mensagens[0].content.text.includes("nenhuma lista"), "Usuário autorizado consegue usar");
  }

  // ============================================================
  // TESTE 16: Múltiplas listas por usuário
  // ============================================================
  console.log("\n📋 TESTE 16: Múltiplas listas por usuário");
  console.log("─────────────────────────────────");
  resetData();
  {
    const sock = createMockSock(gruposMock);

    // Criar lista 1
    const msg1 = createMockMsg(
      "!criar-lista vendas 120363423975280243@g.us",
      "65060886032554", false
    );
    await comandoCriarListaTransmissao(msg1, sock, "65060886032554", []);

    // Criar lista 2
    const msg2 = createMockMsg(
      "!criar-lista parceiros 120363402792383817@g.us",
      "65060886032554", false
    );
    await comandoCriarListaTransmissao(msg2, sock, "65060886032554", []);

    const db = JSON.parse(fs.readFileSync(LISTAS_PATH, "utf8"));
    assert(Object.keys(db["65060886032554"]).length === 2, "Usuário tem 2 listas");
    assert(db["65060886032554"]["vendas"] !== undefined, "Lista 'vendas' existe");
    assert(db["65060886032554"]["parceiros"] !== undefined, "Lista 'parceiros' existe");
  }

  // ============================================================
  // TESTE 17: Nome de lista com caracteres inválidos
  // ============================================================
  console.log("\n📋 TESTE 17: Nome de lista com caracteres inválidos");
  console.log("─────────────────────────────────");
  resetData();
  {
    const sock = createMockSock(gruposMock);
    const msg = createMockMsg(
      "!criar-lista minha lista! 120363423975280243@g.us",
      "65060886032554", false
    );
    await comandoCriarListaTransmissao(msg, sock, "65060886032554", []);
    // "minha" será o nome, "lista!" não é ID válido, "120363..." é o ID
    // Na verdade "minha" é o nome e o resto são IDs
    // O nome "minha" é válido
    const db = JSON.parse(fs.readFileSync(LISTAS_PATH, "utf8"));
    // "minha" é o nome, "lista!" e "120363..." são IDs
    // "lista!@g.us" não existe, mas "120363423975280243@g.us" existe
    assert(db["65060886032554"]["minha"] !== undefined, "Nome 'minha' aceito (sem espaços)");
  }

  // ============================================================
  // RESULTADO FINAL
  // ============================================================
  console.log("\n═══════════════════════════════════════════");
  console.log(`   RESULTADO: ${passed} PASSOU | ${failed} FALHOU`);
  console.log("═══════════════════════════════════════════");

  if (failed === 0) {
    console.log("✅ TODOS OS TESTES PASSARAM! Sistema pronto para deploy.");
  } else {
    console.log("❌ Alguns testes falharam. Verifique os erros acima.");
  }

  // Limpar
  resetData();
  restoreAuth();
}

runTests().catch(console.error);
