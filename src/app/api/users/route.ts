import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    { firstName: "Jane", lastName: "Doe" },
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    }
  );
}
