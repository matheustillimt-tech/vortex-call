import { paraE164 } from "./telefone";

export function validarPessoa(d: { nome: string; email: string; senha: string; papel: string }): string | null {
  if (!d.nome.trim()) return "Informe o nome.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim())) return "E-mail inválido.";
  if (d.senha.length < 8 || !/[A-Za-z]/.test(d.senha) || !/\d/.test(d.senha)) {
    return "A senha precisa ter pelo menos 8 caracteres, com letra e número.";
  }
  if (d.papel !== "admin" && d.papel !== "membro") return "Papel inválido.";
  return null;
}

/** WhatsApp da pessoa da equipe (pros avisos do vendedor): vazio = sem WhatsApp; senão tem que virar E.164
 *  (`paraE164`, Brasil por padrão). */
export function lerWhatsappEquipe(texto: string): { whatsapp: string | null } | { erro: string } {
  const t = texto.trim();
  if (!t) return { whatsapp: null };
  const whatsapp = paraE164(t);
  return whatsapp ? { whatsapp } : { erro: "Confira o WhatsApp (com DDD)." };
}
