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

function aplicarDados(d) {
  return {
    status: d?.status === "bloqueado" ? "bloqueado" : "ativo",
    permissoes: {
      criarContratos: lerPermissao(d?.permissoes?.criarContratos, PERMISSOES_PADRAO.criarContratos),
      criarClientes: lerPermissao(d?.permissoes?.criarClientes, PERMISSOES_PADRAO.criarClientes),
      criarFuncionarios: lerPermissao(d?.permissoes?.criarFuncionarios, PERMISSOES_PADRAO.criarFuncionarios),
    },
    limites: {
      // `??` (não `||`) para preservar limite = 0 quando o campo
      // está presente mas é zero (caso válido: 0 = sem limite).
      contratos: d?.limites?.contratos != null && Number.isFinite(Number(d.limites.contratos))
        ? Number(d.limites.contratos)
        : LIMITES_PADRAO.contratos,
      clientes: d?.limites?.clientes != null && Number.isFinite(Number(d.limites.clientes))
        ? Number(d.limites.clientes)
        : LIMITES_PADRAO.clientes,
      funcionarios: d?.limites?.funcionarios != null && Number.isFinite(Number(d.limites.funcionarios))
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
    permissoes: dados.permissoes,
    limites: dados.limites,
    loading,
  };
}
