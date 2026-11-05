
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const publishableKey =
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
      console.error("Missing Supabase invitation configuration.");
      return NextResponse.json(
        { error: "Invitation service is not configured." },
        { status: 500 }
      );
    }

    const authorization = request.headers.get("authorization");

    if (!authorization?.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "You must be signed in." },
        { status: 401 }
      );
    }

    const token = authorization.slice(7).trim();

    const userClient = createClient(supabaseUrl, publishableKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser(token);

    if (userError || !user) {
      return NextResponse.json(
        { error: "Invalid or expired session." },
        { status: 401 }
      );
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Check administrator privileges on the server.
    const { data: employee, error: employeeError } = await adminClient
      .from("mercury_employees")
      .select("role, status")
      .eq("user_id", user.id)
      .single();

    if (
      employeeError ||
      employee?.role !== "admin" ||
      employee?.status !== "approved"
    ) {
      return NextResponse.json(
        { error: "Only approved administrators can invite employees." },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => null);
    const email =
      typeof body?.email === "string"
        ? body.email.trim().toLowerCase()
        : "";

    if (
      !email ||
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      return NextResponse.json(
        { error: "Enter a valid employee email address." },
        { status: 400 }
      );
    }

    const origin = new URL(request.url).origin;

    const { error: inviteError } =
      await adminClient.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${origin}/`,
      });

    if (inviteError) {
      console.error("Employee invitation failed:", inviteError.message);

      return NextResponse.json(
        { error: "Unable to send invitation. Check the email or try again." },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Employee invitation sent successfully.",
    });
  } catch (error) {
    console.error("Invitation endpoint error:", error);

    return NextResponse.json(
      { error: "Unable to process employee invitation." },
      { status: 500 }
    );
  }
}
