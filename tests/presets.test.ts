import { describe, expect, it } from "vitest";
import { montarPreset, presetDa, PRESETS } from "@/src/lib/regras/presets";

describe("presets", () => {
  it("convidado: fala e câmera permitidas, sem tela, sem gravar, chat público e privado", () => {
    const p = montarPreset("vortex_convidado", "#0a8452") as any;
    expect(p.name).toBe("vortex_convidado");
    expect(p.config.view_type).toBe("GROUP_CALL");
    expect(p.permissions.media.audio.can_produce).toBe("ALLOWED");
    expect(p.permissions.media.video.can_produce).toBe("ALLOWED");
    expect(p.permissions.media.screenshare.can_produce).toBe("NOT_ALLOWED");
    expect(p.permissions.can_record).toBe(false);
    expect(p.permissions.kick_participant).toBe(false);
    expect(p.permissions.chat.public.can_send).toBe(true);
    expect(p.permissions.chat.private.can_send).toBe(true);
    expect(p.permissions.hidden_participant).toBe(false);
  });
  it("anfitrião: tela, gravar, silenciar, remover, fixar", () => {
    const p = montarPreset("vortex_anfitriao", "#0a8452") as any;
    expect(p.permissions.media.screenshare.can_produce).toBe("ALLOWED");
    expect(p.permissions.can_record).toBe(true);
    expect(p.permissions.disable_participant_audio).toBe(true);
    expect(p.permissions.kick_participant).toBe(true);
    expect(p.permissions.pin_participant).toBe(true);
  });
  it("espião: invisível, não produz mídia, não fala no chat", () => {
    const p = montarPreset("vortex_espiao", "#0a8452") as any;
    expect(p.permissions.hidden_participant).toBe(true);
    expect(p.permissions.media.audio.can_produce).toBe("NOT_ALLOWED");
    expect(p.permissions.media.video.can_produce).toBe("NOT_ALLOWED");
    expect(p.permissions.chat.public.can_send).toBe(false);
  });
  it("participante (reunião instantânea): como o convidado, mas compartilha tela", () => {
    const p = montarPreset("vortex_participante", "#0a8452") as any;
    const c = montarPreset("vortex_convidado", "#0a8452") as any;
    expect(p.name).toBe("vortex_participante");
    expect(p.permissions.media.screenshare.can_produce).toBe("ALLOWED");
    expect(p.permissions.media.audio.can_produce).toBe("ALLOWED");
    expect(p.permissions.media.video.can_produce).toBe("ALLOWED");
    expect(p.permissions.can_record).toBe(false);
    expect(p.permissions.kick_participant).toBe(false);
    expect(p.permissions.disable_participant_audio).toBe(false);
    expect(p.permissions.hidden_participant).toBe(false);
    expect(p.permissions.chat.public).toEqual({ can_send: true, text: true, files: true });
    expect(p.permissions.chat.private).toEqual({ can_send: true, can_receive: true, text: true, files: true });
    const semTela = (x: any) => ({ ...x, name: "", permissions: { ...x.permissions, media: { ...x.permissions.media, screenshare: null } } });
    expect(semTela(p)).toEqual(semTela(c));
  });
  it("leva a cor da marca nos tokens", () => {
    expect((montarPreset("vortex_convidado", "#123456") as any).ui.design_tokens.colors.brand[500]).toBe("#123456");
  });
  it("tem os campos que a API exige", () => {
    const p = montarPreset("vortex_convidado", "#0a8452") as any;
    expect(p.permissions.can_accept_production_requests).toBe(false);
    expect(p.permissions.recorder_type).toBe("NONE");
    expect(p.permissions.connected_meetings).toEqual({ can_alter_connected_meetings: false, can_switch_connected_meetings: false, can_switch_to_parent_meeting: false });
  });
  it("transcrição: só os presets _transcricao ligam, iguais ao papel base no resto", () => {
    for (const nome of ["vortex_anfitriao", "vortex_convidado", "vortex_espiao", "vortex_participante"] as const) {
      expect((montarPreset(nome, "#0a8452") as any).permissions.transcription_enabled).toBe(false);
    }
    for (const base of ["vortex_anfitriao", "vortex_convidado", "vortex_participante"] as const) {
      const t = montarPreset(`${base}_transcricao`, "#0a8452") as any;
      const b = montarPreset(base, "#0a8452") as any;
      expect(t.name).toBe(`${base}_transcricao`);
      expect(t.permissions.transcription_enabled).toBe(true);
      expect({ ...t.permissions, transcription_enabled: false }).toEqual(b.permissions);
      expect(t.config).toEqual(b.config);
    }
    expect(PRESETS).toHaveLength(7);
    expect(PRESETS).not.toContain("vortex_espiao_transcricao");
  });
  it("presetDa: sem transcrição o de sempre; com, o _transcricao (espião nunca)", () => {
    expect(presetDa("anfitriao", false)).toBe("vortex_anfitriao");
    expect(presetDa("convidado", false)).toBe("vortex_convidado");
    expect(presetDa("anfitriao", true)).toBe("vortex_anfitriao_transcricao");
    expect(presetDa("convidado", true)).toBe("vortex_convidado_transcricao");
    expect(presetDa("participante", true)).toBe("vortex_participante_transcricao");
    expect(presetDa("espiao", true)).toBe("vortex_espiao");
  });
});
