import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getTieModel } from '@/lib/tieStore';

/** GET /api/model: the caller's tie-strength model (weights, bias, how many labels it learned from). */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const state = await getTieModel(session.user.email.toLowerCase());
    const response = NextResponse.json({ persisted: state.available, model: state.model });
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (error) {
    console.error('Tie model read failed:', error);
    return NextResponse.json({ error: 'Failed to read the model' }, { status: 500 });
  }
}
