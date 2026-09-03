import { useEffect, useState } from "react";
import { ThemeContext } from "./ThemeContext";

const CHAVE = "Cred Facil-tema";

function temaInicial() {
  const salvo = localStorage.getItem(CHAVE);
  if (salvo === "claro" || salvo === "escuro") return salvo;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "escuro"
    : "claro";
}

export default function ThemeProvider({ children }) {
  const [tema, setTema] = useState(temaInicial);

  // Aplica a classe `dark` no <html> e persiste a escolha
  useEffect(() => {
    document.documentElement.classList.toggle("dark", tema === "escuro");
    localStorage.setItem(CHAVE, tema);
  }, [tema]);

  function alternarTema(novo) {
    setTema(novo);
  }

  return (
    <ThemeContext.Provider value={{ tema, alternarTema }}>
      {children}
    </ThemeContext.Provider>
  );
}
