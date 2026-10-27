export type PapelPreset = "anfitriao" | "convidado" | "espiao" | "participante";
export type NomePreset =
  | "vortex_anfitriao" | "vortex_convidado" | "vortex_espiao" | "vortex_participante"
  | "vortex_anfitriao_transcricao" | "vortex_convidado_transcricao" | "vortex_participante_transcricao";

/** Todos os presets que o `rtk:setup` cria/atualiza. Os `_transcricao` são iguais ao papel base, mas com a
 *  transcrição ao vivo ligada: o RealtimeKit transcreve quem entra com `transcription_enabled`, em qualquer meeting,
 *  então só a sala de sessão com transcrição usa esses (ver `presetDa`). O espião nunca é transcrito. */
export const PRESETS: NomePreset[] = [
  "vortex_anfitriao", "vortex_convidado", "vortex_espiao", "vortex_participante",
  "vortex_anfitriao_transcricao", "vortex_convidado_transcricao", "vortex_participante_transcricao",
];

/** Preset de cada papel na sala: com `transcreve`, o `_transcricao` (menos o espião, que não fala). */
export function presetDa(papel: PapelPreset, transcreve: boolean): NomePreset {
  if (!transcreve || papel === "espiao") return `vortex_${papel}`;
  return `vortex_${papel}_transcricao`;
}

const SIM = "ALLOWED";
const NAO = "NOT_ALLOWED";

/** Monta o corpo de preset do RealtimeKit (POST/PATCH /presets) pros 4 papéis. `vortex_participante` é a pessoa
 *  de fora da reunião instantânea: como o convidado, mas pode compartilhar a tela. */
export function montarPreset(nome: NomePreset, corMarca: string): object {
  const transcreve = nome.endsWith("_transcricao");
  const base = nome.replace(/_transcricao$/, "");
  const anfitriao = base === "vortex_anfitriao";
  const espiao = base === "vortex_espiao";
  const participante = base === "vortex_participante";
  const fala = espiao ? NAO : SIM;
  return {
    name: nome,
    config: {
      view_type: "GROUP_CALL",
      max_screenshare_count: 1,
      max_video_streams: { desktop: 25, mobile: 6 },
      media: { video: { quality: "vga", frame_rate: 24 }, screenshare: { quality: "hd", frame_rate: 15 }, audio: {} },
    },
    permissions: {
      media: { audio: { can_produce: fala }, video: { can_produce: fala }, screenshare: { can_produce: anfitriao || participante ? SIM : NAO } },
      can_record: anfitriao,
      can_livestream: false,
      kick_participant: anfitriao,
      pin_participant: anfitriao,
      can_spotlight: anfitriao,
      disable_participant_audio: anfitriao,
      disable_participant_video: anfitriao,
      disable_participant_screensharing: anfitriao,
      can_change_participant_permissions: anfitriao,
      accept_waiting_requests: false,
      waiting_room_type: "SKIP",
      show_participant_list: true,
      can_edit_display_name: false,
      hidden_participant: espiao,
      transcription_enabled: transcreve,
      chat: {
        public: { can_send: !espiao, text: true, files: !espiao },
        private: { can_send: !espiao, can_receive: true, text: true, files: !espiao },
      },
      polls: { can_create: anfitriao, can_view: true, can_vote: !espiao },
      plugins: { can_start: false, can_close: false, can_edit_config: false, config: {} },
      // Obrigatórios na API de presets (conferido em 22/10/2026): sem palco, sem gravador, sem salas conectadas.
      can_accept_production_requests: false,
      recorder_type: "NONE",
      connected_meetings: { can_alter_connected_meetings: false, can_switch_connected_meetings: false, can_switch_to_parent_meeting: false },
    },
    ui: {
      design_tokens: {
        theme: "light",
        border_radius: "rounded",
        border_width: "thin",
        spacing_base: 4,
        font_family: "Inter",
        colors: {
          brand: { 300: corMarca, 400: corMarca, 500: corMarca, 600: corMarca, 700: corMarca },
          background: { 600: "#e4e4e7", 700: "#ececef", 800: "#f4f4f5", 900: "#fafafa", 1000: "#ffffff" },
          danger: "#dc2626", success: "#16a34a", warning: "#d97706", text: "#09090b", text_on_brand: "#ffffff", video_bg: "#d4d4d8",
        },
      },
    },
  };
}
