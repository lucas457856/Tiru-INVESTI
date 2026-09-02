// Hook que conecta o Firestore de notificações ao estado React.
// Usado por:
//   - Dashboard (badge do sino, contador de não lidas)
//   - Página /notificacoes (lista + filtros + marcar como lida)
//
// Fonte única de verdade: o hook ouve `onSnapshot` e o React rerenderiza
// quem o consome. Marcar como lida propaga imediatamente para todos os
// consumidores via re-emissão do snapshot.

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/useAuth";
import {
  marcarComoLida as serviceMarcarComoLida,
  marcarTodasComoLidas as serviceMarcarTodasComoLidas,
  observarNotificacoes,
} from "../services/notificationsService";

export function useNotificacoes() {
  const { usuario } = useAuth();
  const uid = usuario?.uid || null;

  const [notificacoes, setNotificacoes] = useState([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    if (!uid) {
      setNotificacoes([]);
      setCarregando(false);
      return;
    }
    setCarregando(true);
    const unsub = observarNotificacoes(
      uid,
      (lista) => {
        setNotificacoes(lista);
        setCarregando(false);
      },
      (err) => {
        console.error("useNotificacoes:", err);
        setCarregando(false);
      },
    );
    return unsub;
  }, [uid]);

  const naoLidas = useMemo(
    () => notificacoes.filter((n) => !n.lida).length,
    [notificacoes],
  );

  return {
    notificacoes,
    naoLidas,
    carregando,
    marcarComoLida: (id) => serviceMarcarComoLida(uid, id),
    marcarTodasComoLidas: () => serviceMarcarTodasComoLidas(uid),
  };
}
