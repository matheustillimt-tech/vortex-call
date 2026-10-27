import {
  ChartLine,
  Circle,
  CircleUser,
  Clock,
  Monitor,
  MonitorSmartphone,
  ShoppingCart,
  Smartphone,
  UserCheck,
  Wallet,
  CircleAlert,
  Clapperboard,
  FileText,
  Film,
  Headset,
  History,
  House,
  Inbox,
  Info,
  LayoutDashboard,
  Paperclip,
  Radio,
  Settings,
  Split,
  Users,
  Video,
  type LucideIcon,
} from "lucide-react";

export type { LucideIcon };

/**
 * Nomes antigos do Material Icons → ícone lucide equivalente. Só pra quem ainda chama `<Icone nome="…">`;
 * código novo passa o componente direto: `<Icone icone={History} />` ou `<History size={20} />`.
 */
const POR_NOME: Record<string, LucideIcon> = {
  home: House,
  dashboard: LayoutDashboard,
  videocam: Video,
  video_library: Clapperboard,
  movie: Film,
  web: FileText,
  call_split: Split,
  support_agent: Headset,
  group: Users,
  history: History,
  settings: Settings,
  inbox: Inbox,
  info: Info,
  error_outline: CircleAlert,
  sensors: Radio,
  query_stats: ChartLine,
  attach_file: Paperclip,
  computer: Monitor,
  devices: MonitorSmartphone,
  how_to_reg: UserCheck,
  payments: Wallet,
  person: CircleUser,
  schedule: Clock,
  shopping_cart: ShoppingCart,
  smartphone: Smartphone,
};

/** Ícone do painel (lucide, traço 2). `icone` aceita o componente lucide; `nome`, o nome antigo
 *  do Material (ver `POR_NOME`). Tamanho padrão 20 px (menu e botões); 16 px em texto. */
export function Icone({
  icone,
  nome,
  className = "",
  tamanho = 20,
  rotulo,
}: {
  icone?: LucideIcon;
  nome?: string;
  className?: string;
  tamanho?: number;
  /** Texto pra leitor de tela. Sem ele, o ícone é decorativo (`aria-hidden`). */
  rotulo?: string;
}) {
  const Componente = icone ?? (nome ? POR_NOME[nome] : undefined) ?? Circle;
  return (
    <Componente
      size={tamanho}
      strokeWidth={2}
      className={`shrink-0 ${className}`}
      aria-hidden={rotulo ? undefined : true}
      aria-label={rotulo}
      role={rotulo ? "img" : undefined}
    />
  );
}
