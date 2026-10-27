import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { ehWellKnown, precisaRenovarSessao, rotaPublica } from "@/src/lib/regras/rota";

export async function middleware(req: NextRequest) {
  // Descoberta de cliente MCP (`/.well-known/...`): 404 em JSON, nunca o redirect pro login.
  if (ehWellKnown(req.nextUrl.pathname)) return NextResponse.json({ erro: "não encontrado" }, { status: 404 });
  if (!precisaRenovarSessao(req.nextUrl.pathname)) return NextResponse.next();

  let res = NextResponse.next({ request: req });
  const db = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (lista) => {
        lista.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        lista.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });
  const { data } = await db.auth.getUser();
  // Pública que só renova o login (`/r/`): sem login segue como visitante, nunca redireciona.
  if (rotaPublica(req.nextUrl.pathname)) return res;
  if (!data.user) {
    if (req.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return res;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"] };
