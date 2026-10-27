export function Carregando({ texto }: { texto: string }) {
  return (
    <div className="flex h-full min-h-dvh w-full flex-1 flex-col items-center justify-center gap-3 bg-white text-sm text-zinc-500">
      <span className="size-6 animate-spin rounded-full border-2 border-zinc-200 border-t-marca" aria-hidden />
      <p>{texto}</p>
    </div>
  );
}
