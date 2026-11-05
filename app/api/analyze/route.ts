import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";



const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(request: NextRequest) {
  try {
    const key = process.env.OPENAI_API_KEY;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!key || !supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json({ error: "AI service is not configured." }, { status: 503 });
    }

    const authorization = request.headers.get("authorization") ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!token) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: auth, error: authError } = await supabase.auth.getUser(token);
    if (authError || !auth.user) return NextResponse.json({ error: "Invalid session." }, { status: 401 });

    const { data: employee, error: employeeError } = await supabase
      .from("mercury_employees")
      .select("role, status")
      .eq("user_id", auth.user.id)
      .maybeSingle();
    if (employeeError || employee?.status !== "approved") {
      return NextResponse.json({ error: "Employee access is not approved." }, { status: 403 });
    }

    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return NextResponse.json({ error: "Expected JSON request." }, { status: 415 });
    }
    const body = await request.json();
    const projectId = typeof body?.projectId === "string" ? body.projectId : "";
    const imageDataUrl = typeof body?.imageDataUrl === "string" ? body.imageDataUrl : "";
    const match = /^data:(image\/jpeg|image\/png|image\/webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(imageDataUrl);
    if (!projectId || !match || !ALLOWED_TYPES.has(match[1])) {
      return NextResponse.json({ error: "Provide a project ID and a JPEG, PNG, or WebP image." }, { status: 400 });
    }
    const imageBytes = Buffer.from(match[2], "base64");
    if (imageBytes.length === 0 || imageBytes.length > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: "Image must be under 2 MB." }, { status: 413 });
    }

    const { data: project, error: projectError } = await supabase
      .from("mercury_projects")
      .select("id, owner_id")
      .eq("id", projectId)
      .maybeSingle();
    if (projectError || !project) return NextResponse.json({ error: "Project not found or inaccessible." }, { status: 404 });

    if (employee.role !== "admin") {
      const { data: share, error: shareError } = await supabase
        .from("mercury_project_shares")
        .select("permission")
        .eq("project_id", projectId)
        .eq("shared_with", auth.user.id)
        .eq("permission", "edit")
        .maybeSingle();
      if (shareError || !share) return NextResponse.json({ error: "Walkthrough editing permission required." }, { status: 403 });
    } else if (project.owner_id !== auth.user.id) {
      return NextResponse.json({ error: "Project access denied." }, { status: 403 });
    }

    const openai = new OpenAI({ apiKey: key });
    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      max_output_tokens: 650,
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: "You are assisting a professional painting estimator. Inspect this photo and describe only visible evidence. Identify likely paintable surfaces, visible condition/problems, recommended preparation, and uncertainties. Never invent dimensions, square footage, paint quantity, hidden damage, or material types that cannot be confirmed. Reply in concise plain English with headings: Surfaces, Visible condition, Suggested preparation, Need to verify. Do not include prices." },
          { type: "input_image", image_url: imageDataUrl, detail: "low" },
        ],
      }],
    });
    return NextResponse.json({ analysis: response.output_text });
  } catch (error) {
    console.error("Mercury AI analysis failed:", error);
    return NextResponse.json({ error: "Photo analysis failed. Please try again." }, { status: 500 });
  }
}
