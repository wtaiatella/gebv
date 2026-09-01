import { NextResponse } from 'next/server';
import { runScraper } from '@/app/lib/scraper';

export async function POST() {
  try {
    const data = await runScraper();
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message || 'Failed to scrape data' 
    }, { status: 500 });
  }
}
