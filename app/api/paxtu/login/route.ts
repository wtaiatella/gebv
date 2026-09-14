import { NextRequest, NextResponse } from 'next/server';
import { loginPaxtu } from '@/app/lib/paxtu/auth';

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

    // Retorna sucesso e seta o cookie na resposta HTTP do browser (para persistir entre abas/sessões)
    const response = NextResponse.json({
      success: true,
      message: 'Autenticado com sucesso no Paxtu 100!',
      user,
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
    console.error('[API /api/paxtu/login Error]:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Falha ao conectar no Paxtu 100.',
      },
      { status: 401 }
    );
  }
}

