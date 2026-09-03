import { useEffect, useState } from "react";
import { buscarContrato } from "../services/contractService";

// Hook para buscar contrato + cliente do Firestore com estados de carregamento.
// Estados: "carregando" | "pronto" | "nao-encontrado" | "erro"
export default function useContract(usuario, id) {
  const [contrato, setContrato] = useState(null);
  const [cliente, setCliente] = useState(null);
  const [estado, setEstado] = useState("carregando");
  const [erro, setErro] = useState(null);

  useEffect(() => {
    if (!usuario || !id) {
      setEstado("carregando");
      return;
    }
    let ativo = true;
    setEstado("carregando");
    setErro(null);

    buscarContrato(usuario, id)
      .then((dados) => {
        if (!ativo) return;
        if (!dados) {
          setEstado("nao-encontrado");
          setContrato(null);
          setCliente(null);
          return;
        }
        setContrato(dados.contrato);
        setCliente(dados.cliente);
        setEstado("pronto");
      })
      .catch((err) => {
        if (!ativo) return;
        console.error("Erro ao carregar contrato:", err);
        if (err?.code === "permission-denied") {
          setEstado("nao-encontrado");
        } else {
          setEstado("erro");
          setErro(err);
        }
      });

    return () => { ativo = false; };
  }, [usuario?.uid, id]);

  return { contrato, cliente, estado, erro };
}
