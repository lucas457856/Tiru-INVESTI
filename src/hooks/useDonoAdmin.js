// Hook que observa em tempo real o documento do DONO (usuarios/{ownerUid})
// e devolve { permissoes, limites, status, loading }.
//
// Por que isso existe:
//   - O AuthProvider já escuta o doc do DONO para detectar `status` (donoBloqueado).
//   - Mas ele NÃO expõe `permissoes`/`limites` no contexto.
//   - Várias páginas (Funcionarios, Clientes, Contratos) precisam dessa
//     informação para mostrar banners e desabilitar botões.
//
// Implementação: onSnapshot direto no doc do DONO. O Firestore Rules
// permite o próprio usuário ler o seu doc (allow get em usuarios/{uid}),
// então isso é seguro para o DONO.
//
// Para funcionários: usa effectiveUid (que é o ownerUid), e o Rules
// permite que funcionários leiam o doc do dono (já que o funcionário
// tem vínculo com o dono via ownerUid no Firestore Rules atual).
//
// Loading: derivado. É `true` enquanto não temos UID efetivo OU antes
// do primeiro callback do onSnapshot. O componente consumidor não
// precisa distinguir — defaults permissivos são devolvidos no
// interim, e a primeira leitura do snapshot substitui rapidamente.
import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../services/firebase";
import { useAuth } from "../context/useAuth";
import { useEffectiveUid } from "./useEffectiveUid";

// Defaults que valem para donos SEM configuração administrativa no
// Firestore. Decisão do administrador: novos donos começam com
// limites 5/5/5 e SEM permissão de criar funcionários — o admin
// ativa manualmente quando liberar.
const PERMISSOES_PADRAO = {
  criarContratos: true,
  criarClientes: true,
  criarFuncionarios: false,
};

const LIMITES_PADRAO = {
  contratos: 5,
  clientes: 5,
  funcionarios: 5,
};

function defaults() {
  return {
    status: "ativo",
    plan: "free",
    vigencia: null,
    permissoes: PERMISSOES_PADRAO,
    limites: LIMITES_PADRAO,
    carregou: false,
  };
}

// Lê uma permissão do Firestore respeitando o default — equivalente
// ao helper em `api/admin/overview.js`. Mantemos a duplicação porque
// o cliente não tem como importar o módulo serverless diretamente.
function lerPermissao(valor, padrao) {
  if (valor === true || valor === false) return valor;
  return padrao;
}

// Espelha o helper backend `planoEfetivo` em `api/_lib/dono.js`.
// Recebe o doc cru do Firestore (com `plan` e `planVigencia`) e
// devolve { configurado, efetivo, status, vigenciaInicio, vigenciaFim }.
// Mantém compatibilidade: donos sem `planVigencia` retornam
// efetivo === configurado.
function planoEfetivoCliente(d, agora) {
  const ref = agora || new Date();
  const configurado = d?.plan === "pro" ? "pro" : "free";
  const vigencia = d?.planVigencia;
  if (configurado !== "pro" || !vigencia || typeof vigencia !== "object") {
    return {
      configurado,
      efetivo: configurado,
      status: "indefinido",
      vigenciaInicio: null,
      vigenciaFim: null,
    };
  }
  // Converte Timestamp (Admin/Client) ou Date ou string "YYYY-MM-DD"
  // em um `Date` que representa 00:00 UTC do dia YYYY-MM-DD.
  //
  // IMPORTANTE — DRIFT DE TIMEZONE:
  //   O servidor (Vercel, UTC) grava `Timestamp.fromDate(new Date(y,
  //   m-1, d))` — meia-noite LOCAL do servidor, que é meia-noite
  //   UTC. Quando o Client SDK do Firestore (browser do usuário)
  //   lê esse Timestamp via `ts.toDate()`, retorna o mesmo
  //   instante UTC. Mas `dt.getDate()`/`getMonth()`/`getFullYear()`
  //   no browser retornam componentes no timezone LOCAL do
  //   browser — em BRT (UTC-3), meia-noite UTC vira "ontem 21h",
  //   então `getDate()` retorna o dia anterior. Isso fazia
  //   `planoEfetivoCliente` calcular `status` como "expirado" 1
  //   dia antes, e a UI mostrar o bloco de validade incorretamente.
  //
  //   Solução: usar os componentes UTC (`getUTCFullYear()` etc.)
  //   para extrair o "dia" — o mesmo YYYY-MM-DD que o admin
  //   configurou no drawer. O `Date` retornado fica em meia-noite
  //   UTC do dia, e a comparação `hoje < tFim / hoje >= tFim` usa
  //   `hoje` em meia-noite LOCAL do browser (correto: "hoje
  //   no Brasil") contra `tFim` em meia-noite UTC (correto:
  //   "data configurada pelo admin"). A diferença entre os dois
  //   é de até 1 dia, e o resultado bate com a regra "inicio é
  //   inclusivo, fim é o primeiro dia Free".
  const toUtcDay = (v) => {
    if (!v) return null;
    if (typeof v === "object" && typeof v.toDate === "function") {
      const dt = v.toDate();
      return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
    }
    if (v instanceof Date) {
      return new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));
    }
    if (typeof v === "string") {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
      if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    }
    return null;
  };
  const inicio = toUtcDay(vigencia.inicio);
  const fim = toUtcDay(vigencia.fim);
  // `hoje` continua sendo meia-noite LOCAL do browser — é a data
  // que o usuário vê no calendário do sistema operacional dele.
  const hoje = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate()).getTime();
  const tInicio = inicio ? inicio.getTime() : null;
  const tFim = fim ? fim.getTime() : null;
  let status = "indefinido";
  if (tInicio != null && tFim != null) {
    if (hoje < tInicio) status = "agendado";
    else if (hoje >= tFim) status = "expirado";
    else status = "ativo";
  }
  return {
    configurado,
    efetivo: status === "ativo" ? "pro" : "free",
    status,
    vigenciaInicio: inicio,
    vigenciaFim: fim,
  };
}

function serializarVigencia(plano) {
  if (plano.status === "indefinido" || !plano.vigenciaInicio || !plano.vigenciaFim) {
    return null;
  }
  return {
    configurado: plano.configurado,
    efetivo: plano.efetivo,
    status: plano.status,
    inicio: plano.vigenciaInicio.toISOString(),
    fim: plano.vigenciaFim.toISOString(),
  };
}

function aplicarDados(d) {
  const plano = planoEfetivoCliente(d);
  const ehProEfetivo = plano.efetivo === "pro";
  return {
    status: d?.status === "bloqueado" ? "bloqueado" : "ativo",
    plan: plano.configurado, // plano CONFIGURADO (string "free"|"pro")
    vigencia: serializarVigencia(plano), // objeto {configurado, efetivo, status, inicio, fim} ou null
    statusPlano: plano.status, // "ativo"|"agendado"|"expirado"|"indefinido"
    permissoes: {
      criarContratos: lerPermissao(d?.permissoes?.criarContratos, PERMISSOES_PADRAO.criarContratos),
      criarClientes: lerPermissao(d?.permissoes?.criarClientes, PERMISSOES_PADRAO.criarClientes),
      criarFuncionarios: lerPermissao(d?.permissoes?.criarFuncionarios, PERMISSOES_PADRAO.criarFuncionarios),
    },
    limites: {
      // `??` (não `||`) para preservar limite = 0 quando o campo
      // está presente mas é zero (caso válido: 0 = sem limite).
      // Quando o plano EFETIVO é "pro", substituímos os limites por 0
      // (ilimitado) para que o restante do sistema — que já sabe
      // tratar limite = 0 como "sem limite" — bloqueie corretamente.
      // Os limites FREE originais continuam salvos no Firestore
      // (em `limites.contratos/clientes/funcionarios`); basta
      // voltar para Free efetivo (configurado=free, ou Pro expirado)
      // para que voltem a valer.
      contratos: ehProEfetivo
        ? 0
        : d?.limites?.contratos != null && Number.isFinite(Number(d.limites.contratos))
          ? Number(d.limites.contratos)
          : LIMITES_PADRAO.contratos,
      clientes: ehProEfetivo
        ? 0
        : d?.limites?.clientes != null && Number.isFinite(Number(d.limites.clientes))
          ? Number(d.limites.clientes)
          : LIMITES_PADRAO.clientes,
      funcionarios: ehProEfetivo
        ? 0
        : d?.limites?.funcionarios != null && Number.isFinite(Number(d.limites.funcionarios))
          ? Number(d.limites.funcionarios)
          : LIMITES_PADRAO.funcionarios,
    },
    carregou: true,
  };
}

export function useDonoAdmin() {
  const { usuario, roleResolvido } = useAuth();
  const effectiveUid = useEffectiveUid();
  // Lazy initializer: defaults permissivos. Os valores reais são
  // preenchidos via callback do onSnapshot (sistema externo).
  const [dados, setDados] = useState(defaults);

  useEffect(() => {
    if (!roleResolvido || !effectiveUid || !usuario) return undefined;
    const ref = doc(db, "usuarios", effectiveUid);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const d = snap.exists() ? snap.data() || {} : {};
        setDados(aplicarDados(d));
      },
      () => {
        setDados({ ...defaults(), carregou: true });
      },
    );
    return () => unsub();
  }, [usuario, roleResolvido, effectiveUid]);

  // Loading: ainda não temos o UID efetivo OU o primeiro callback
  // do snapshot ainda não chegou.
  const loading =
    !roleResolvido || !effectiveUid || !dados.carregou;

  return {
    status: dados.status,
    plan: dados.plan, // "free"|"pro" — plano configurado
    vigencia: dados.vigencia, // {configurado, efetivo, status, inicio, fim} | null
    statusPlano: dados.statusPlano, // "ativo"|"agendado"|"expirado"|"indefinido"
    permissoes: dados.permissoes,
    limites: dados.limites,
    loading,
  };
}
