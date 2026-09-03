// Teste do gerador de PDF com dados reais do Firestore + logo real do projeto
import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc } from "firebase/firestore";
import { readFile } from "node:fs/promises";
import { gerarPdfContrato, calcularParcelas } from "./src/utils/pdfContrato.js";
import { formatarData } from "./src/utils/formatadores.js";

// Mesma config de src/services/firebase.js
const app = initializeApp({
  apiKey: "AIzaSyC4vD6Y8h6XKf8vGpZQnJmRlT3wO2xYb9M",
  authDomain: "agt-controller3.firebaseapp.com",
  projectId: "agt-controller3",
  storageBucket: "agt-controller3.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef1234567890abcdef",
});
const db = getFirestore(app);

const UID = process.argv[2];
const CONTRATO_ID = process.argv[3];
if (!UID || !CONTRATO_ID) {
  console.error("Uso: node teste-pdf.mjs <uid> <idDoContrato>");
  process.exit(1);
}

const snap = await getDoc(doc(db, "usuarios", UID, "contratos", CONTRATO_ID));
if (!snap.exists()) {
  console.error("Contrato não encontrado:", CONTRATO_ID);
  process.exit(1);
}
const contrato = { id: snap.id, ...snap.data() };
console.log("Contrato:", contrato.nome, "| parcelas:", contrato.numeroParcelas, "| frequência:", contrato.frequencia);

let cliente = null;
if (contrato.clienteId) {
  const c = await getDoc(doc(db, "clientes", contrato.clienteId));
  if (c.exists()) cliente = { id: c.id, ...c.data() };
}
console.log("Cliente:", cliente?.nomeCompleto, "| telefone:", cliente?.telefone);

const logoDataUrl = `data:image/png;base64,${(await readFile("./src/assets/Cred Facil-logo.png")).toString("base64")}`;

// Cronograma calculado (valida status/datas)
const parcelas = calcularParcelas(contrato, new Date());
console.log("\nParcelas calculadas:");
for (const p of parcelas) {
  console.log(
    `  ${p.numero} | ${p.vencimento ? formatarData(p.vencimento) : "-"} | ${p.valor} | ${p.recebido} | ${p.status}`
  );
}

const numeroDoc = gerarPdfContrato({ contrato, cliente, logoDataUrl });
console.log("\nPDF gerado:", `comprovante-${numeroDoc}.pdf`);
