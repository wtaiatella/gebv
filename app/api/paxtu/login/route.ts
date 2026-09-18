import { NextRequest, NextResponse } from 'next/server';
import { loginPaxtu } from '@/app/lib/paxtu/auth';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { user, password } = body;

    if (!user || !password) {
      return NextResponse.json(
        { success: false, error: 'Usuário e senha são obrigatórios.' },
        { status: 400 }
      );
    }

    const cookie = await loginPaxtu(user.trim(), password.trim());

    // Atualiza a variável no ambiente em execução para sincronizações do servidor
    process.env.PAXTU_COOKIE = cookie;

    // Atualiza o .env em disco de forma resiliente
    try {
      const envPath = path.join(process.cwd(), '.env');
      let envContent = await readFile(envPath, 'utf-8').catch(() => '');
      const line = `PAXTU_COOKIE="${cookie}"`;
      if (/^PAXTU_COOKIE=/m.test(envContent)) {
        envContent = envContent.replace(/^PAXTU_COOKIE=.*$/m, line);
      } else {
        envContent = envContent.trimEnd() + (envContent.trim() ? '\n' : '') + line + '\n';
      }
      await writeFile(envPath, envContent);
    } catch (envErr) {
      console.warn('[API /api/paxtu/login] Não foi possível persistir PAXTU_COOKIE no .env:', envErr);
    }

    // Retorna sucesso e seta o cookie na resposta HTTP do browser (para persistir entre abas/sessões)
    const response = NextResponse.json({
      success: true,
      message: 'Autenticado com sucesso no Paxtu 100!',
      user,
      cookie,
    });

    response.cookies.set('paxtu_session', cookie, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 8, // 8 horas
    });

    return response;
  } catch (error: any) {
    console.error('[API /api/paxtu/login Error]:', error?.message || error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Falha ao conectar no Paxtu 100.',
      },
      { status: 401 }
    );
  }
}

