import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

function requireAdmin(req: NextRequest) {
  const key = req.headers.get("x-api-key");
  return !!key && key === process.env.ADMIN_API_KEY;
}

export async function POST(req: NextRequest) {
  if (!requireAdmin(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { playerName, team, occurredAt, accelerationG } = body ?? {};
    if (!playerName || !occurredAt || typeof accelerationG !== "number") {
      return NextResponse.json({ error: "playerName, occurredAt and accelerationG are required" }, { status: 400 });
    }

    const event = await prisma.event.create({
      data: {
        playerName,
        team: team ?? null,
        occurredAt: new Date(occurredAt),
        accelerationG,
      },
    });
    return NextResponse.json({ event }, { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "invalid request";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}


