import { NextResponse } from "next/server";
import { getAdminHealthSnapshot } from "@/lib/admin-health";

export const dynamic = "force-dynamic";

export async function GET() {
  const snapshot = await getAdminHealthSnapshot();
  return NextResponse.json(snapshot, {
    status: snapshot.overall === "ok" ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
}
