import { NextResponse } from "next/server";

import { getHealthStatus } from "@/lib/health";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(getHealthStatus());
}
