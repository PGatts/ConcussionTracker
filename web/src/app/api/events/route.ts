import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? 25), 200);
  const cursor = searchParams.get("cursor") ?? undefined;
  const playerName = searchParams.get("playerName") ?? undefined;
  const team = searchParams.get("team") ?? undefined;
  // accelMin/Max are in g and stored as g
  const accelMinG = searchParams.get("accelMin") ? Number(searchParams.get("accelMin")) : undefined;
  const accelMaxG = searchParams.get("accelMax") ? Number(searchParams.get("accelMax")) : undefined;
  const angularMin = searchParams.get("angularMin") ? Number(searchParams.get("angularMin")) : undefined;
  const angularMax = searchParams.get("angularMax") ? Number(searchParams.get("angularMax")) : undefined;
  const timeFrom = searchParams.get("timeFrom") ? new Date(searchParams.get("timeFrom")!) : undefined;
  const timeTo = searchParams.get("timeTo") ? new Date(searchParams.get("timeTo")!) : undefined;
  const sortBy = (searchParams.get("sortBy") ?? "occurredAt") as "occurredAt" | "accelerationG" | "angularVelocity";
  const order = (searchParams.get("order") ?? "desc") as "asc" | "desc";

  const where: Prisma.EventWhereInput = {
    ...(playerName ? { playerName: { contains: playerName } } : {}),
    ...(team ? { team } : {}),
    ...((accelMinG !== undefined || accelMaxG !== undefined) ? {
      accelerationG: {
        ...(accelMinG !== undefined ? { gte: accelMinG } : {}),
        ...(accelMaxG !== undefined ? { lte: accelMaxG } : {}),
      },
    } : {}),
    ...((angularMin !== undefined || angularMax !== undefined) ? {
      angularVelocity: {
        ...(angularMin !== undefined ? { gte: angularMin } : {}),
        ...(angularMax !== undefined ? { lte: angularMax } : {}),
      },
    } : {}),
    ...((timeFrom || timeTo) ? {
      occurredAt: {
        ...(timeFrom ? { gte: timeFrom } : {}),
        ...(timeTo ? { lte: timeTo } : {}),
      },
    } : {}),
  };

  const events = await prisma.event.findMany({
    take: limit + 1,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    where,
    orderBy: { [sortBy]: order },
  });

  const nextCursor = events.length > limit ? events.pop()!.id : null;
  return NextResponse.json({ data: events, nextCursor });
}
