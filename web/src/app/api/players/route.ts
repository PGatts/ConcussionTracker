import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search") ?? undefined;
  const limit = Math.min(Number(searchParams.get("limit") ?? 25), 100);

  const data = await prisma.event.findMany({
    where: search ? { playerName: { contains: search } } : {},
    select: { playerName: true, team: true },
    distinct: ["playerName"],
    take: limit,
    orderBy: { playerName: "asc" },
  });

  return NextResponse.json({ data });
}
