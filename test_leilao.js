// TESTE COMPLETO — Sistema de Leilão por Enquete-Venda (Ferdinando_Cloud)
import {
  storeMessage,
  getStoredMessage,
  computeOptionHash,
  temSessaoAtiva,
  getSessaoAtiva,
  iniciarSessao,
  registrarEnquete,
  registrarVotosAgregados,
  registrarVotoFallback,
  getStatusSessao,
  cancelarSessao,
  encerrarSessao,
  gerarAnuncioGrupo,
  gerarRelatorioComprador,
  gerarRelatorioAdmin,
  formatarReais,
  extrairValorNumerico,
} from "./src/core/leilaoManager.js";

import fs from "fs";
import path from "path";

const DATA_DIR = path.resolve("src/data");
const LEILOES_PATH = path.join(DATA_DIR, "leiloes_ativos.json");
const HISTORICO_PATH = path.join(DATA_DIR, "historico_leiloes.json");
const MESSAGE_STORE_PATH = path.join(DATA_DIR, "message_store.json");

// Reset dos arquivos antes dos testes
function resetFiles() {
  fs.writeFileSync(LEILOES_PATH, JSON.stringify({ sessoes: {} }, null, 2));
  fs.writeFileSync(HISTORICO_PATH, JSON.stringify({ historico: [] }, null, 2));
  fs.writeFileSync(MESSAGE_STORE_PATH, JSON.stringify({}, null, 2));
}

// Contadores
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

// ============================================================
console.log("\n═══════════════════════════════════════════");
console.log("   TESTES — Sistema de Leilão (Ferdinando_Cloud)");
console.log("═══════════════════════════════════════════\n");

// ============================================================
// TESTE 1: Funções utilitárias
// ============================================================
console.log("📋 TESTE 1: Funções Utilitárias");
console.log("─────────────────────────────────");

assert(extrairValorNumerico("R$ 50") === 50, "Extrai R$ 50 → 50");
assert(extrairValorNumerico("R$ 100,00") === 100, "Extrai R$ 100,00 → 100");
assert(extrairValorNumerico("R$200") === 200, "Extrai R$200 → 200");
assert(extrairValorNumerico("150") === 150, "Extrai 150 → 150");
assert(extrairValorNumerico("R$ 1.500,00") === 1500, "Extrai R$ 1.500,00 → 1500");
assert(extrairValorNumerico("R$ 10,50") === 10.5, "Extrai R$ 10,50 → 10.5");
assert(extrairValorNumerico("Sem valor") === 0, "Extrai 'Sem valor' → 0");
assert(extrairValorNumerico("") === 0, "Extrai '' → 0");
assert(extrairValorNumerico(null) === 0, "Extrai null → 0");

assert(formatarReais(100) === "R$ 100,00", "Formata 100 → R$ 100,00");
assert(formatarReais(1500.5) === "R$ 1500,50", "Formata 1500.5 → R$ 1500,50");

const hash1 = computeOptionHash("R$ 50");
const hash2 = computeOptionHash("R$ 100");
assert(hash1.length === 64, "Hash tem 64 caracteres (SHA-256)");
assert(hash1 !== hash2, "Hashes diferentes para opções diferentes");

// ============================================================
// TESTE 2: Gerenciamento de Sessão
// ============================================================
resetFiles();
console.log("\n📋 TESTE 2: Gerenciamento de Sessão");
console.log("─────────────────────────────────");

const GROUP_JID = "120363000000000000@g.us";
const ADMIN_JID = "5511999999999@s.whatsapp.net";

assert(!temSessaoAtiva(GROUP_JID), "Sem sessão ativa inicialmente");

const r1 = iniciarSessao(GROUP_JID, ADMIN_JID);
assert(r1.ok === true, "Iniciar sessão retorna ok");
assert(temSessaoAtiva(GROUP_JID), "Sessão ativa após iniciar");

const r2 = iniciarSessao(GROUP_JID, ADMIN_JID);
assert(r2.ok === false, "Não permite iniciar sessão duplicada");
assert(r2.motivo === "ja_ativo", "Motivo correto: ja_ativo");

const sessao = getSessaoAtiva(GROUP_JID);
assert(sessao !== null, "getSessaoAtiva retorna a sessão");
assert(sessao.status === "ativo", "Status da sessão é 'ativo'");
assert(sessao.iniciadoPor === ADMIN_JID, "Admin correto na sessão");

// ============================================================
// TESTE 3: Registro de Enquetes
// ============================================================
console.log("\n📋 TESTE 3: Registro de Enquetes");
console.log("─────────────────────────────────");

const e1 = registrarEnquete(GROUP_JID, "POLL_001", "Pikachu Holo 1st Ed", ["R$ 50", "R$ 100", "R$ 150", "R$ 200"]);
assert(e1.ok === true, "Enquete 1 registrada com sucesso");

const e2 = registrarEnquete(GROUP_JID, "POLL_002", "Charizard Base Set", ["R$ 100", "R$ 200", "R$ 300"]);
assert(e2.ok === true, "Enquete 2 registrada com sucesso");

const e3 = registrarEnquete(GROUP_JID, "POLL_003", "Bulbasaur Promo", ["R$ 10", "R$ 20"]);
assert(e3.ok === true, "Enquete 3 registrada com sucesso");

const e4 = registrarEnquete("grupo_inexistente@g.us", "POLL_X", "Teste", ["A", "B"]);
assert(e4.ok === false, "Não registra enquete sem sessão ativa");

const sessao2 = getSessaoAtiva(GROUP_JID);
assert(Object.keys(sessao2.enquetes).length === 3, "3 enquetes registradas na sessão");
assert(sessao2.enquetes["POLL_001"].opcoes.length === 4, "Enquete 1 tem 4 opções");
assert(sessao2.enquetes["POLL_001"].opcoes[0].texto === "R$ 50", "Primeira opção é 'R$ 50'");
assert(sessao2.enquetes["POLL_001"].opcoes[0].hash.length === 64, "Hash da opção tem 64 chars");

// ============================================================
// TESTE 4: Registro de Votos Agregados
// ============================================================
console.log("\n📋 TESTE 4: Registro de Votos Agregados");
console.log("─────────────────────────────────");

const votosEnq1 = {
  "R$ 150": { voters: ["VOTER_1@s.whatsapp.net"], count: 1 },
  "R$ 200": { voters: ["VOTER_2@s.whatsapp.net"], count: 1 },
};
const rv1 = registrarVotosAgregados(GROUP_JID, "POLL_001", votosEnq1);
assert(rv1 === true, "Votos agregados registrados na enquete 1");

const votosEnq2 = {
  "R$ 300": { voters: ["VOTER_3@s.whatsapp.net"], count: 1 },
};
const rv2 = registrarVotosAgregados(GROUP_JID, "POLL_002", votosEnq2);
assert(rv2 === true, "Votos agregados registrados na enquete 2");

const sessao3 = getSessaoAtiva(GROUP_JID);
assert(Object.keys(sessao3.enquetes["POLL_001"].votos).length === 2, "Enquete 1 tem 2 votos");
assert(sessao3.enquetes["POLL_001"].votos["VOTER_1@s.whatsapp.net"].opcaoTexto === "R$ 150", "Voto de R$ 150 registrado");
assert(sessao3.enquetes["POLL_001"].votos["VOTER_2@s.whatsapp.net"].opcaoTexto === "R$ 200", "Voto de R$ 200 registrado");

// ============================================================
// TESTE 5: Registro de Votos Fallback (Hashes)
// ============================================================
resetFiles();
console.log("\n📋 TESTE 5: Registro de Votos Fallback (Hashes)");
console.log("─────────────────────────────────");

iniciarSessao(GROUP_JID, ADMIN_JID);
registrarEnquete(GROUP_JID, "POLL_FB_1", "Item Fallback", ["R$ 10", "R$ 20", "R$ 30"]);

const hashR20 = computeOptionHash("R$ 20");
const rfb1 = registrarVotoFallback(GROUP_JID, "POLL_FB_1", "5511111111111@s.whatsapp.net", [hashR20]);
assert(rfb1 === true, "Voto fallback registrado com sucesso");

const sessaoFB = getSessaoAtiva(GROUP_JID);
assert(sessaoFB.enquetes["POLL_FB_1"].votos["5511111111111@s.whatsapp.net"].opcaoTexto === "R$ 20", "Fallback mapeou hash para 'R$ 20' corretamente");

// Teste remoção de voto
const rfb2 = registrarVotoFallback(GROUP_JID, "POLL_FB_1", "5511111111111@s.whatsapp.net", []);
assert(rfb2 === true, "Remoção de voto funciona");

const sessaoFB2 = getSessaoAtiva(GROUP_JID);
assert(!sessaoFB2.enquetes["POLL_FB_1"].votos["5511111111111@s.whatsapp.net"], "Voto removido com sucesso");

// ============================================================
// TESTE 6: Status do Leilão
// ============================================================
console.log("\n📋 TESTE 6: Status do Leilão");
console.log("─────────────────────────────────");

const status = getStatusSessao(GROUP_JID);
assert(status !== null, "Status retornado com sucesso");
assert(status.totalEnquetes === 1, "Total de enquetes correto");
assert(getStatusSessao("outro_grupo@g.us") === null, "Status null para grupo sem sessão");

// ============================================================
// TESTE 7: Encerramento e Geração de Relatórios
// ============================================================
resetFiles();
console.log("\n📋 TESTE 7: Encerramento e Geração de Relatórios");
console.log("─────────────────────────────────");

iniciarSessao(GROUP_JID, ADMIN_JID);
registrarEnquete(GROUP_JID, "E1", "Pikachu Holo", ["R$ 50", "R$ 100", "R$ 150"]);
registrarEnquete(GROUP_JID, "E2", "Charizard Base", ["R$ 100", "R$ 200", "R$ 300"]);
registrarEnquete(GROUP_JID, "E3", "Mewtwo GX", ["R$ 30", "R$ 50", "R$ 80"]);
registrarEnquete(GROUP_JID, "E4", "Bulbasaur Promo", ["R$ 5", "R$ 10"]);

// Registrar votos
registrarVotosAgregados(GROUP_JID, "E1", {
  "R$ 100": { voters: ["VOTER_2@s.whatsapp.net"], count: 1 },
  "R$ 150": { voters: ["VOTER_1@s.whatsapp.net"], count: 1 },
});
registrarVotosAgregados(GROUP_JID, "E2", {
  "R$ 300": { voters: ["VOTER_3@s.whatsapp.net"], count: 1 },
});
registrarVotosAgregados(GROUP_JID, "E3", {
  "R$ 50": { voters: ["VOTER_2@s.whatsapp.net"], count: 1 },
  "R$ 80": { voters: ["VOTER_1@s.whatsapp.net"], count: 1 },
});
// E4 sem votos (item sem lance)

const dados = encerrarSessao(GROUP_JID, "Grupo Teste TCG");
assert(dados.ok === true, "Encerramento retorna ok");
assert(dados.resultados.length === 3, "3 itens vendidos");
assert(dados.itensSemLance.length === 1, "1 item sem lance");
assert(dados.itensSemLance[0] === "Bulbasaur Promo", "Item sem lance é 'Bulbasaur Promo'");

// Verificar vencedores
const pikachu = dados.resultados.find(r => r.descricao === "Pikachu Holo");
assert(pikachu.vencedorJid === "VOTER_1@s.whatsapp.net", "Vencedor do Pikachu é VOTER_1 (R$ 150)");
assert(pikachu.valorNumerico === 150, "Valor correto: 150");

const charizard = dados.resultados.find(r => r.descricao === "Charizard Base");
assert(charizard.vencedorJid === "VOTER_3@s.whatsapp.net", "Vencedor do Charizard é VOTER_3 (R$ 300)");
assert(charizard.valorNumerico === 300, "Valor correto: 300");

const mewtwo = dados.resultados.find(r => r.descricao === "Mewtwo GX");
assert(mewtwo.vencedorJid === "VOTER_1@s.whatsapp.net", "Vencedor do Mewtwo é VOTER_1 (R$ 80)");

assert(dados.faturamentoTotal === 530, "Faturamento total: R$ 530");
assert(Object.keys(dados.comprasPorPessoa).length === 2, "2 compradores distintos");

const comprasV1 = dados.comprasPorPessoa["VOTER_1@s.whatsapp.net"];
assert(comprasV1.total === 230, "VOTER_1 total: R$ 230 (150 + 80)");
assert(comprasV1.itens.length === 2, "VOTER_1 comprou 2 itens");

const comprasV3 = dados.comprasPorPessoa["VOTER_3@s.whatsapp.net"];
assert(comprasV3.total === 300, "VOTER_3 total: R$ 300");

assert(!temSessaoAtiva(GROUP_JID), "Sessão removida após encerramento");

const historico = JSON.parse(fs.readFileSync(HISTORICO_PATH, "utf8"));
assert(historico.historico.length === 1, "Histórico tem 1 registro");
assert(historico.historico[0].faturamentoTotal === 530, "Faturamento no histórico correto");

// ============================================================
// TESTE 8: Geração de Relatórios (Texto)
// ============================================================
console.log("\n📋 TESTE 8: Geração de Relatórios (Texto)");
console.log("─────────────────────────────────");

const anuncio = gerarAnuncioGrupo(dados);
assert(anuncio.texto.includes("LEILÃO ENCERRADO"), "Anúncio contém título");
assert(anuncio.texto.includes("Pikachu Holo"), "Anúncio contém item 1");
assert(anuncio.texto.includes("Charizard Base"), "Anúncio contém item 2");
assert(anuncio.texto.includes("Mewtwo GX"), "Anúncio contém item 3");
assert(anuncio.texto.includes("Bulbasaur Promo"), "Anúncio contém item sem lance");
assert(anuncio.mentions.length > 0, "Anúncio tem mentions dos vencedores");

const relComprador = gerarRelatorioComprador("VOTER_1@s.whatsapp.net", comprasV1, "Grupo Teste TCG");
assert(relComprador.includes("Pikachu Holo"), "Relatório comprador contém item 1");
assert(relComprador.includes("Mewtwo GX"), "Relatório comprador contém item 2");
assert(relComprador.includes("R$ 230,00"), "Relatório comprador contém total");

const relAdmin = gerarRelatorioAdmin(dados, "Grupo Teste TCG");
assert(relAdmin.texto.includes("RELATÓRIO DE LEILÃO"), "Relatório admin contém título");
assert(relAdmin.texto.includes("R$ 530,00"), "Relatório admin contém faturamento total");
assert(relAdmin.texto.includes("RESUMO POR COMPRADOR"), "Relatório admin contém resumo por comprador");
assert(relAdmin.mentions.length > 0, "Relatório admin tem mentions");

// ============================================================
// TESTE 9: Cancelamento de Sessão
// ============================================================
resetFiles();
console.log("\n📋 TESTE 9: Cancelamento de Sessão");
console.log("─────────────────────────────────");

iniciarSessao(GROUP_JID, ADMIN_JID);
registrarEnquete(GROUP_JID, "EC1", "Item Cancelado", ["R$ 10", "R$ 20"]);

const cancel = cancelarSessao(GROUP_JID);
assert(cancel.ok === true, "Cancelamento retorna ok");
assert(!temSessaoAtiva(GROUP_JID), "Sessão removida após cancelamento");

const cancel2 = cancelarSessao(GROUP_JID);
assert(cancel2.ok === false, "Cancelamento falha sem sessão ativa");

// ============================================================
// TESTE 10: Message Store
// ============================================================
console.log("\n📋 TESTE 10: Message Store");
console.log("─────────────────────────────────");

const fakeMsg = {
  key: { remoteJid: "grupo@g.us", id: "MSG_TEST_123" },
  message: { pollCreationMessage: { name: "Teste Poll" } },
};
storeMessage(fakeMsg);

const retrieved = getStoredMessage({ remoteJid: "grupo@g.us", id: "MSG_TEST_123" });
assert(retrieved !== undefined, "Mensagem recuperada do store");
assert(retrieved.message.pollCreationMessage.name === "Teste Poll", "Conteúdo da mensagem correto");

const notFound = getStoredMessage({ remoteJid: "grupo@g.us", id: "INEXISTENTE" });
assert(notFound === undefined, "Retorna undefined para mensagem inexistente");

// ============================================================
// TESTE 11: Empate de Votos (Desempate por Timestamp)
// ============================================================
resetFiles();
console.log("\n📋 TESTE 11: Empate de Votos (Desempate por Timestamp)");
console.log("─────────────────────────────────");

iniciarSessao(GROUP_JID, ADMIN_JID);
registrarEnquete(GROUP_JID, "EMPATE_1", "Item Empate", ["R$ 100", "R$ 200"]);

// Ambos votam R$ 200, mas VOTER_A votou primeiro (timestamp menor)
registrarVotosAgregados(GROUP_JID, "EMPATE_1", {
  "R$ 200": { voters: ["VOTER_A@s.whatsapp.net", "VOTER_B@s.whatsapp.net"], count: 2 },
});

const dadosEmpate = encerrarSessao(GROUP_JID, "Grupo Empate");
assert(dadosEmpate.ok === true, "Encerramento com empate funciona");
assert(dadosEmpate.resultados[0].vencedorJid === "VOTER_A@s.whatsapp.net", "Primeiro a votar vence no empate");

// ============================================================
// RESULTADO FINAL
// ============================================================
console.log("\n═══════════════════════════════════════════");
console.log(`   RESULTADO: ${passed} PASSOU | ${failed} FALHOU`);
console.log("═══════════════════════════════════════════");

if (failed === 0) {
  console.log("✅ TODOS OS TESTES PASSARAM! Sistema pronto para deploy.\n");
} else {
  console.log("❌ ALGUNS TESTES FALHARAM! Verifique os erros acima.\n");
  process.exit(1);
}
