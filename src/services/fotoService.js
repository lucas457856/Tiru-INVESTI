// Serviço de foto do cliente — mesmo padrão do projeto de referência
// (adriele-joias): upload para o Cloudinary e somente a URL no Firestore.
// Nunca grava o arquivo nem base64 dentro do documento.

const CLOUD_NAME = "dfbci2sh4";
const UPLOAD_PRESET = "adriele_preset";
const PASTA = "clientes";

const TAMANHO_MAX = 5 * 1024 * 1024; // 5 MB
const TIPOS_ACEITOS = new Set(["image/jpeg", "image/png", "image/webp"]);

// Valida tipo e tamanho; retorna mensagem de erro ou null quando válida
export function validarFoto(file) {
  if (!file) return "Nenhuma imagem selecionada.";
  if (!TIPOS_ACEITOS.has(file.type)) {
    return "Formato inválido. Use apenas JPG, PNG ou WEBP.";
  }
  if (file.size > TAMANHO_MAX) {
    return "Imagem muito grande. O limite é 5 MB.";
  }
  return null;
}

// Envia o arquivo ao Cloudinary e devolve a resposta completa (url + metadados)
async function enviarArquivo(file, mensagemErro) {
  const data = new FormData();
  data.append("file", file);
  data.append("upload_preset", UPLOAD_PRESET);
  data.append("folder", PASTA);

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`,
    { method: "POST", body: data }
  );

  const json = await res.json();
  if (!json.secure_url) {
    throw new Error(mensagemErro);
  }
  return json;
}

// Envia a foto de perfil e devolve a URL segura
export async function enviarFoto(file) {
  const erro = validarFoto(file);
  if (erro) throw new Error(erro);

  const json = await enviarArquivo(file, "Não foi possível enviar a foto. Tente novamente.");
  return json.secure_url;
}

// Envia um documento e devolve o objeto pronto para o array `documentos`
export async function enviarDocumento(file) {
  const erro = validarFoto(file);
  if (erro) throw new Error(erro);

  const json = await enviarArquivo(file, "Não foi possível enviar o documento. Tente novamente.");
  return {
    id: `doc-${json.public_id}-${Date.now().toString(36)}`,
    nome: file.name,
    url: json.secure_url,
    tipo: file.type,
    tamanho: file.size,
    publicId: json.public_id,
    createdAt: new Date().toISOString(),
  };
}
