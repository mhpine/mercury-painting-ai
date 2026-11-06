"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabase";

type Project = {
  id: string;
  ownerId: string;
  customerName: string;
  address: string;
  projectType?: string;
  paintingType?: string;
};

type Opening = {
  id: string;
  kind: "Window" | "Door" | "Other";
  count: number;
  width: number;
  height: number;
};

type Surface = {
  id: string;
  name: string;
  category?: string;
  length: number;
  height: number;
  squareFeet: number; // NET area; existing Estimates page uses this field.
  grossSquareFeet?: number;
  deductedSquareFeet?: number;
  openings?: Opening[];
  condition: string;
  preparation: string;
  coats: number;
  notes: string;
  photo?: string; // Legacy embedded photos, kept for backward compatibility.
  photoPath?: string; // New permanent private Storage location.
};

type ProjectPhoto = { path: string; name: string; url: string; createdAt?: string | null };
const PHOTO_BUCKET = "mercury-project-photos";

type EmployeeRole = "admin" | "employee";
type WalkthroughData = { surfaces?: Surface[] };

type AiFindings = {
  name?: string;
  category?: string;
  condition?: string;
  preparation?: string;
  coats?: string;
  notes?: string;
};

const allowedConditions = ["Good", "Fair", "Poor", "Damaged"];
const allowedPreparations = ["None", "Cleaning", "Sanding", "Scraping", "Patching", "Priming", "Multiple Steps"];

function allowedChoice(value: unknown, options: string[]): string | undefined {
  if (typeof value !== "string") return undefined;
  return options.find((option) => option.toLowerCase() === value.trim().toLowerCase());
}

const navigation = [
  { label: "Dashboard", href: "/" },
  { label: "Projects", href: "/projects" },
  { label: "Estimates", href: "/estimates" },
  { label: "Settings", href: "/settings" },
];
const categories = [
  "Wall", "Ceiling", "Trim", "Door", "Siding", "Deck", "Fence", "Other",
];
const blankForm = () => ({
  name: "",
  category: "Wall",
  length: "",
  height: "",
  condition: "Good",
  preparation: "None",
  coats: "2",
  notes: "",
});

const round = (n: number) => Math.round(n * 100) / 100;
const formatArea = (n: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: 2 });

export default function WalkthroughPage() {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [role, setRole] = useState<EmployeeRole | null>(null);
  const [userId, setUserId] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadingSurfaces, setLoadingSurfaces] = useState(false);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data, error }) => {
      if (mounted) {
        if (error) console.error("Unable to check session:", error);
        setLoggedIn(Boolean(data.session));
      }
    });
    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (mounted) setLoggedIn(Boolean(session));
      }
    );
    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    const { error } = await supabase.auth.signOut();
    if (error) {
      alert(error.message);
      setSigningOut(false);
      return;
    }
    setLoggedIn(false);
    setMenuOpen(false);
    router.replace("/login");
    router.refresh();
  }

  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [surfaces, setSurfaces] = useState<Surface[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState(blankForm);
  const [openings, setOpenings] = useState<Opening[]>([]);
  const [photo, setPhoto] = useState("");
  const [photoPath, setPhotoPath] = useState("");
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [projectPhotos, setProjectPhotos] = useState<ProjectPhoto[]>([]);
  const [loadingPhotos, setLoadingPhotos] = useState(false);
  const [photoGalleryError, setPhotoGalleryError] = useState("");
  const [analyzingPhoto, setAnalyzingPhoto] = useState(false);
  const [photoAnalysis, setPhotoAnalysis] = useState("");
  const [aiFindings, setAiFindings] = useState<AiFindings | null>(null);
  const [photoAnalysisError, setPhotoAnalysisError] = useState("");

  // Projects are loaded from Supabase and filtered by project ownership or an edit share.
  useEffect(() => {
    let active = true;
    async function loadProjects() {
      setLoaded(false);
      setMessage("");
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (!active) return;
      if (authError || !auth.user) {
        setMessage("Please sign in to access walkthroughs.");
        setLoaded(true);
        return;
      }
      setUserId(auth.user.id);
      const { data: employee, error: employeeError } = await supabase
        .from("mercury_employees")
        .select("role, status")
        .eq("user_id", auth.user.id)
        .maybeSingle();
      if (!active) return;
      if (employeeError || employee?.status !== "approved") {
        setMessage("Your employee account is not approved.");
        setLoaded(true);
        return;
      }
      const employeeRole: EmployeeRole = employee.role === "admin" ? "admin" : "employee";
      setRole(employeeRole);
      const { data: projectRows, error: projectError } = await supabase
        .from("mercury_projects")
        .select("id, owner_id, name, customer_name, address, project_data")
        .order("name");
      if (!active) return;
      if (projectError) {
        setMessage(`Unable to load projects: ${projectError.message}`);
        setLoaded(true);
        return;
      }
      let editableIds = new Set<string>();
      if (employeeRole !== "admin") {
        const { data: shares, error: shareError } = await supabase
          .from("mercury_project_shares")
          .select("project_id")
          .eq("shared_with", auth.user.id)
          .eq("permission", "edit");
        if (!active) return;
        if (shareError) {
          setMessage(`Unable to verify project permissions: ${shareError.message}`);
          setLoaded(true);
          return;
        }
        editableIds = new Set((shares ?? []).map((share) => share.project_id));
      }
      const list: Project[] = (projectRows ?? [])
        .filter((row) => employeeRole === "admin" ? row.owner_id === auth.user.id : editableIds.has(row.id))
        .map((row) => {
          const details = row.project_data && typeof row.project_data === "object" && !Array.isArray(row.project_data)
            ? row.project_data as Record<string, unknown> : {};
          return {
            id: row.id,
            ownerId: row.owner_id,
            customerName: String(row.customer_name || details.customerName || row.name || "Project"),
            address: String(row.address || details.address || ""),
          };
        });
      setProjects(list);
      const requested = new URLSearchParams(window.location.search).get("projectId");
      setSelectedProjectId(requested && list.some((item) => item.id === requested)
        ? requested : list[0]?.id ?? "");
      setLoaded(true);
    }
    void loadProjects();
    return () => { active = false; };
  }, []);

  // Walkthrough measurements are shared through the secured Supabase table.
  useEffect(() => {
    let active = true;
    async function loadWalkthrough() {
      setSurfaces([]);
      if (!selectedProjectId) return;
      setLoadingSurfaces(true);
      const { data, error } = await supabase
        .from("mercury_walkthroughs")
        .select("walkthrough_data")
        .eq("project_id", selectedProjectId)
        .maybeSingle();
      if (!active) return;
      if (error) {
        setMessage(`Unable to load walkthrough: ${error.message}`);
      } else {
        const content = data?.walkthrough_data as WalkthroughData | null;
        setSurfaces(Array.isArray(content?.surfaces) ? content.surfaces : []);
      }
      setLoadingSurfaces(false);
    }
    void loadWalkthrough();
    return () => { active = false; };
  }, [selectedProjectId]);

  // Project photos are stored separately from surface measurements. They survive
  // page refreshes, switching devices, and removal of a surface record.
  useEffect(() => {
    let active = true;
    setPhoto("");
    setPhotoPath("");
    setPhotoAnalysis("");
    setAiFindings(null);
    setPhotoAnalysisError("");
    setProjectPhotos([]);
    setPhotoGalleryError("");
    if (!selectedProjectId) return () => { active = false; };

    async function loadPhotos() {
      setLoadingPhotos(true);
      const { data: entries, error } = await supabase.storage
        .from(PHOTO_BUCKET).list(selectedProjectId, {
          limit: 1000, sortBy: { column: "created_at", order: "desc" },
        });
      if (!active) return;
      if (error) {
        setPhotoGalleryError(`Unable to load project photos: ${error.message}`);
        setLoadingPhotos(false);
        return;
      }
      const files = (entries ?? []).filter((item) =>
        item.name && /\.(jpg|jpeg|png|webp)$/i.test(item.name)
      );
      const paths = files.map((item) => `${selectedProjectId}/${item.name}`);
      if (!paths.length) {
        setProjectPhotos([]);
        setLoadingPhotos(false);
        return;
      }
      const { data: signed, error: signedError } = await supabase.storage
        .from(PHOTO_BUCKET).createSignedUrls(paths, 3600);
      if (!active) return;
      if (signedError) {
        setPhotoGalleryError(`Unable to display project photos: ${signedError.message}`);
      } else {
        setProjectPhotos(files.flatMap((item, i) => {
          const url = signed?.[i]?.signedUrl;
          return url ? [{
            path: paths[i], name: item.name, url,
            createdAt: item.created_at,
          }] : [];
        }));
      }
      setLoadingPhotos(false);
    }
    void loadPhotos();
    return () => { active = false; };
  }, [selectedProjectId]);

  async function refreshProjectPhotos(projectId: string) {
    const { data: entries, error } = await supabase.storage
      .from(PHOTO_BUCKET).list(projectId, {
        limit: 1000, sortBy: { column: "created_at", order: "desc" },
      });
    if (error) throw error;
    const files = (entries ?? []).filter((item) =>
      item.name && /\.(jpg|jpeg|png|webp)$/i.test(item.name)
    );
    const paths = files.map((item) => `${projectId}/${item.name}`);
    if (!paths.length) {
      if (selectedProjectId === projectId) setProjectPhotos([]);
      return;
    }
    const { data: signed, error: signedError } = await supabase.storage
      .from(PHOTO_BUCKET).createSignedUrls(paths, 3600);
    if (signedError) throw signedError;
    if (selectedProjectId === projectId) {
      setProjectPhotos(files.flatMap((item, i) => {
        const url = signed?.[i]?.signedUrl;
        return url ? [{ path: paths[i], name: item.name, url,
          createdAt: item.created_at }] : [];
      }));
    }
  }

  const selectedProject = projects.find((p) => p.id === selectedProjectId);
  const totalSquareFeet = surfaces.reduce((sum, s) => sum + s.squareFeet, 0);
  const totalPaintArea = surfaces.reduce(
    (sum, s) => sum + s.squareFeet * s.coats, 0
  );
  const totalDeductions = surfaces.reduce(
    (sum, s) => sum + (s.deductedSquareFeet ?? 0), 0
  );

  const gross = Number(form.length) * Number(form.height);
  const grossArea = Number.isFinite(gross) && gross > 0 ? gross : 0;
  const deductedArea = openings.reduce(
    (sum, o) => sum + o.count * o.width * o.height, 0
  );
  const netArea = Math.max(0, grossArea - deductedArea);

  async function saveSurfaces(updated: Surface[]): Promise<boolean> {
    const project = projects.find((item) => item.id === selectedProjectId);
    if (!project || !userId || saving || loadingSurfaces || uploadingPhoto) return false;
    setSaving(true);
    try {
      // A unique constraint on project_id prevents duplicate walkthrough records.
      // Database RLS and the ownership trigger enforce project-level access.
      const { error } = await supabase.from("mercury_walkthroughs").upsert({
        project_id: project.id,
        owner_id: project.ownerId,
        walkthrough_data: { surfaces: updated },
        updated_at: new Date().toISOString(),
      }, { onConflict: "project_id" });
      if (error) throw error;
      setSurfaces(updated);
      setMessage("Walkthrough saved successfully.");
      return true;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setMessage(`Unable to save walkthrough: ${detail}`);
      return false;
    } finally {
      setSaving(false);
    }
  }

  function addOpening() {
    setOpenings((old) => [
      ...old,
      { id: crypto.randomUUID(), kind: "Window", count: 1, width: 3, height: 5 },
    ]);
  }

  function updateOpening(id: string, patch: Partial<Opening>) {
    setOpenings((old) => old.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  }

  async function addSurface(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProjectId) {
      setMessage("Select a project first.");
      return;
    }
    if (uploadingPhoto) {
      setMessage("Please wait for your photo to finish saving.");
      return;
    }
    if (photo && !photoPath) {
      setMessage("The photo has not been saved to the project. Please select it again.");
      return;
    }
    const length = Number(form.length);
    const height = Number(form.height);
    const coats = Number(form.coats);
    if (
      !form.name.trim() || !Number.isFinite(length) || length <= 0 ||
      !Number.isFinite(height) || height <= 0 ||
      !Number.isInteger(coats) || coats < 1 || coats > 4
    ) {
      setMessage("Enter a surface name, positive dimensions, and 1–4 coats.");
      return;
    }
    if (openings.some((o) =>
      !Number.isInteger(o.count) || o.count < 1 ||
      !Number.isFinite(o.width) || o.width <= 0 ||
      !Number.isFinite(o.height) || o.height <= 0
    )) {
      setMessage("Each opening needs a whole-number quantity and positive dimensions.");
      return;
    }
    const grossSqFt = round(length * height);
    const deductionSqFt = round(openings.reduce(
      (sum, o) => sum + o.count * o.width * o.height, 0
    ));
    if (deductionSqFt >= grossSqFt) {
      setMessage("Openings must total less than the gross surface area.");
      return;
    }
    const surface: Surface = {
      id: crypto.randomUUID(),
      name: form.name.trim(),
      category: form.category,
      length,
      height,
      grossSquareFeet: grossSqFt,
      deductedSquareFeet: deductionSqFt,
      openings: openings.map((o) => ({ ...o })),
      squareFeet: round(grossSqFt - deductionSqFt),
      condition: form.condition,
      preparation: form.preparation,
      coats,
      notes: form.notes.trim(),
      photoPath: photoPath || undefined,
    };
    if (await saveSurfaces([...surfaces, surface])) {
      setForm(blankForm());
      setOpenings([]);
      setPhoto("");
      setPhotoPath("");
      setPhotoAnalysis("");
    setAiFindings(null);
      setPhotoAnalysisError("");
      const fileInput = document.getElementById("surface-photo") as HTMLInputElement | null;
      if (fileInput) fileInput.value = "";
    }
  }

  async function deleteSurface(id: string) {
    if (window.confirm("Remove this surface from the walkthrough?")) {
      await saveSurfaces(surfaces.filter((s) => s.id !== id));
    }
  }

  async function analyzePhoto() {
    if (!photo || !selectedProjectId || analyzingPhoto || uploadingPhoto || !photoPath) return;
    setAnalyzingPhoto(true);
    setPhotoAnalysis("");
    setAiFindings(null);
    setPhotoAnalysisError("");
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (sessionError || !token) throw new Error("Please sign in again to analyze a photo.");
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ projectId: selectedProjectId, imageDataUrl: photo }),
      });
    const result: { analysis?: string; error?: string; findings?: AiFindings } = await response.json();
    if (!response.ok) throw new Error(result.error || `AI request failed (${response.status}).`);
    if (!result.analysis?.trim() && !result.findings) {
      throw new Error("The AI returned no analysis. Try another photo.");
    }
    setPhotoAnalysis(result.analysis || result.findings?.notes || "AI findings ready for review.");
    if (result.findings) {
      setAiFindings(result.findings);
      applyFindingsToForm(result.findings, result.analysis || "");
      setMessage("AI findings added to the form. Review all suggestions and enter measured dimensions before saving.");
    } else {
      setMessage("AI analysis is available, but no structured form suggestions were returned.");
    }
    } catch (error) {
      setPhotoAnalysisError(error instanceof Error ? error.message : "Unable to analyze photo.");
    } finally {
      setAnalyzingPhoto(false);
    }
  }

  function applyFindingsToForm(ai: AiFindings, analysisText: string) {
    const category = allowedChoice(ai.category, categories);
    const condition = allowedChoice(ai.condition, allowedConditions);
    const preparation = allowedChoice(ai.preparation, allowedPreparations);
    const coats = typeof ai.coats === "string" && /^[1-4]$/.test(ai.coats.trim())
      ? ai.coats.trim() : undefined;
    const observation = [ai.notes?.trim(), analysisText.trim()]
      .filter((part, index, items): part is string => Boolean(part) && items.indexOf(part) === index)
      .join("\n\n");
    const noteBlock = observation ? `AI photo observations (verify on site):\n${observation}` : "";

    setForm((current) => ({
      ...current,
      name: ai.name?.trim() || current.name,
      ...(category ? { category } : {}),
      ...(condition ? { condition } : {}),
      ...(preparation ? { preparation } : {}),
      ...(coats ? { coats } : {}),
      notes: noteBlock && !current.notes.includes(noteBlock)
        ? (current.notes.trim() ? `${current.notes.trim()}\n\n${noteBlock}` : noteBlock)
        : current.notes,
      // Never infer or overwrite measured length/height or opening deductions.
    }));
  }

  function applyAiSuggestions() {
    if (!aiFindings) return;
    applyFindingsToForm(aiFindings, photoAnalysis);
    setMessage("AI suggestions applied. Verify each field and enter measured dimensions before saving.");
    document.getElementById("surface-name")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function handlePhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !selectedProjectId || uploadingPhoto) return;
    const projectId = selectedProjectId;
    setPhotoAnalysis("");
    setAiFindings(null);
    setPhotoAnalysisError("");
    setPhoto("");
    setPhotoPath("");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setMessage("Choose a JPEG, PNG, or WebP image.");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setMessage("Choose an image under 20 MB.");
      return;
    }
    setUploadingPhoto(true);
    setMessage("Preparing and saving photo to this project...");
    try {
      const image = new window.Image();
      const objectUrl = URL.createObjectURL(file);
      let result = "";
      try {
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error("Unable to read the selected photo."));
          image.src = objectUrl;
        });
        const canvas = document.createElement("canvas");
        const maxSide = 1600;
        const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Your browser could not prepare this photo.");
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        let quality = 0.82;
        result = canvas.toDataURL("image/jpeg", quality);
        while (result.length * 0.75 > 1.5 * 1024 * 1024 && quality > 0.4) {
          quality -= 0.1;
          result = canvas.toDataURL("image/jpeg", quality);
        }
        if (result.length * 0.75 > 1.5 * 1024 * 1024) {
          throw new Error("Photo is still too large after compression. Try a smaller photo.");
        }
      } finally {
        URL.revokeObjectURL(objectUrl);
      }

      // Upload the optimized image, not a large base64 string in walkthrough_data.
      const blob = await (await fetch(result)).blob();
      const path = `${projectId}/${crypto.randomUUID()}.jpg`;
      const { error: uploadError } = await supabase.storage.from(PHOTO_BUCKET)
        .upload(path, blob, { contentType: "image/jpeg", upsert: false });
      if (uploadError) throw new Error(`Photo upload failed: ${uploadError.message}`);
      if (selectedProjectId === projectId) {
        setPhoto(result);
        setPhotoPath(path);
        setMessage("Photo saved to this project. You can analyze it now.");
        try {
          await refreshProjectPhotos(projectId);
          setPhotoGalleryError("");
        } catch (galleryError) {
          setPhotoGalleryError(galleryError instanceof Error ? galleryError.message : "Unable to refresh photos.");
        }
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save photo.");
      event.target.value = "";
    } finally {
      setUploadingPhoto(false);
    }
  }

  const canCreateProject = role === "admin";
  const visibleNavigation = navigation.filter((item) => item.href !== "/settings" || role === "admin");

  const inputStyle =
    "w-full rounded-xl border border-gray-200 bg-[#F7F8FA] px-4 py-3.5 text-[#252525] outline-none transition focus:border-[#ED1C24] focus:ring-2 focus:ring-red-100";
  const labelStyle = "mb-2 block text-sm font-bold text-[#252525]";

  return (
    <main className="min-h-screen bg-[#F5F5F5] text-[#252525]">
      {/* Approved Mercury header */}
      <header className="relative z-30 border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-3">
          <Link href="/" className="flex min-w-0 items-center gap-3 sm:gap-5">
            <div className="relative h-20 w-36 shrink-0 sm:h-24 sm:w-52">
              <Image
                src="/images/mercury-logo.png"
                alt="Mercury Painting Company"
                fill
                priority
                sizes="(max-width: 640px) 144px, 208px"
                className="object-contain object-left"
              />
            </div>
            <div className="border-l-4 border-[#FFD400] pl-3 sm:pl-5">
              <span className="text-base font-black uppercase tracking-wide text-[#ED1C24] sm:text-2xl">
                AI ESTIMATOR
              </span>
            </div>
          </Link>
          <nav className="hidden items-center gap-8 lg:flex">
            {visibleNavigation.map((item) => (
              <Link key={item.href} href={item.href}
                className="border-b-4 border-transparent py-2 text-sm font-bold text-gray-600 transition hover:text-[#ED1C24]">
                {item.label}
              </Link>
            ))}
          </nav>
          {canCreateProject && <Link href="/projects/new"
            className="hidden rounded-xl bg-[#ED1C24] px-6 py-4 text-sm font-black text-white shadow-lg transition hover:bg-red-700 sm:inline-flex">
            + New Project
          </Link>}
          {/* One desktop auth button, to the right of New Project */}
          {loggedIn !== null && (
            loggedIn ? (
              <button type="button" onClick={handleSignOut} disabled={signingOut}
                className="hidden rounded-xl border-2 border-[#ED1C24] px-5 py-3 text-sm font-black text-[#ED1C24] transition hover:bg-red-50 disabled:opacity-50 lg:inline-flex">
                {signingOut ? "Signing Out..." : "Log Out"}
              </button>
            ) : (
              <Link href="/login"
                className="hidden rounded-xl border-2 border-[#ED1C24] px-5 py-3 text-sm font-black text-[#ED1C24] transition hover:bg-red-50 lg:inline-flex">
                Log In
              </Link>
            )
          )}
          <button type="button" onClick={() => setMenuOpen(!menuOpen)}
            aria-label={menuOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={menuOpen}
            className="rounded-xl border border-gray-200 px-4 py-3 text-xl lg:hidden">
            {menuOpen ? "✕" : "☰"}
          </button>
        </div>
        {menuOpen && (
          <nav className="absolute left-0 right-0 top-full border-t border-gray-200 bg-white p-5 shadow-xl lg:hidden">
            {[...visibleNavigation,
              { label: "AI Walkthrough", href: "/walkthrough" },
              ...(canCreateProject ? [{ label: "New Project", href: "/projects/new" }] : []),
            ].map((item) => (
              <Link key={item.href} href={item.href}
                onClick={() => setMenuOpen(false)}
                className="block rounded-xl px-4 py-4 font-bold hover:bg-red-50 hover:text-[#ED1C24]">
                {item.label}
              </Link>
            ))}
            {loggedIn !== null && (
              loggedIn ? (
                <button type="button" onClick={handleSignOut} disabled={signingOut}
                  className="mt-3 block w-full rounded-xl bg-[#ED1C24] px-4 py-4 text-left font-black text-white disabled:opacity-50">
                  {signingOut ? "Signing Out..." : "Log Out"}
                </button>
              ) : (
                <Link href="/login" onClick={() => setMenuOpen(false)}
                  className="mt-3 block rounded-xl bg-[#ED1C24] px-4 py-4 font-black text-white">
                  Log In
                </Link>
              )
            )}
          </nav>
        )}
      </header>

      <section className="mx-auto max-w-7xl px-5 py-12">
        <div className="mb-10">
          <div className="mb-4 flex items-center gap-3">
            <span className="h-1.5 w-12 bg-[#ED1C24]" />
            <p className="text-sm font-black uppercase tracking-widest text-[#ED1C24]">
              Smart Estimating
            </p>
          </div>
          <h1 className="text-3xl font-black uppercase tracking-tight sm:text-5xl">
            AI Walkthrough
          </h1>
          <p className="mt-4 max-w-2xl leading-7 text-gray-600">
            Document painting surfaces, record photos and measurements,
            and subtract doors and windows automatically.
          </p>
          <div className="mt-6 h-2 w-28 bg-[#FFD400]" />
        </div>

        <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-md">
          <div className="mb-5 flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-red-50 text-3xl">
              📁
            </div>
            <div>
              <h2 className="text-xl font-black">Select Painting Project</h2>
              <p className="mt-1 text-sm text-gray-500">
                Choose the project you want to document.
              </p>
            </div>
          </div>
          {!loaded ? (
            <p className="text-gray-500">Loading projects...</p>
          ) : projects.length === 0 ? (
            <div className="rounded-xl bg-yellow-50 p-5">
              <p className="font-bold">No projects available for walkthrough editing.</p>
              {canCreateProject && <Link href="/projects/new"
                className="mt-4 inline-flex rounded-xl bg-[#ED1C24] px-5 py-3 font-black text-white">
                + Create First Project
              </Link>}
            </div>
          ) : (
            <>
              <label htmlFor="project" className={labelStyle}>Project</label>
              <select id="project" value={selectedProjectId}
                onChange={(e) => {
                  setSelectedProjectId(e.target.value);
                  setMessage("");
                }}
                className={inputStyle}>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.customerName} — {p.address}
                  </option>
                ))}
              </select>
              {selectedProject && !loadingSurfaces && (
                <p className="mt-4 text-sm text-gray-500">
                  📍 {selectedProject.address}
                </p>
              )}
            </>
          )}
        </div>

        {selectedProject && !loadingSurfaces && (
          <>
            <div className="mt-8 grid gap-5 sm:grid-cols-3">
              {[
                ["Surfaces Recorded", String(surfaces.length), "#ED1C24"],
                ["Net Paintable Area", `${formatArea(totalSquareFeet)} sq ft`, "#FFD400"],
                ["Coated Paint Area", `${formatArea(totalPaintArea)} sq ft`, "#252525"],
              ].map(([label, value, color]) => (
                <div key={label} className="rounded-2xl bg-white p-6 shadow-md">
                  <p className="text-sm font-bold text-gray-500">{label}</p>
                  <p className="mt-3 text-3xl font-black">{value}</p>
                  <div className="mt-4 h-1.5 w-20" style={{ backgroundColor: color }} />
                </div>
              ))}
            </div>
            {totalDeductions > 0 && (
              <p className="mt-4 text-sm font-bold text-gray-600">
                Total opening deductions: {formatArea(totalDeductions)} sq ft
              </p>
            )}

            <form onSubmit={addSurface}
              className="mt-8 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-md">
              <div className="border-b border-gray-100 px-6 py-6">
                <div className="flex items-center gap-4">
                  <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-yellow-100 text-3xl">
                    📐
                  </div>
                  <div>
                    <h2 className="text-xl font-black sm:text-2xl">
                      Add Painting Surface
                    </h2>
                    <p className="mt-1 text-sm text-gray-500">
                      Measure gross area, subtract openings, and save net area.
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-6 p-6">
                <div className="grid gap-5 sm:grid-cols-2">
                  <div>
                    <label htmlFor="surface-name" className={labelStyle}>
                      Surface Name *
                    </label>
                    <input id="surface-name" required className={inputStyle}
                      placeholder="Living Room North Wall"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })} />
                  </div>
                  <div>
                    <label htmlFor="surface-category" className={labelStyle}>
                      Surface Category
                    </label>
                    <select id="surface-category" className={inputStyle}
                      value={form.category}
                      onChange={(e) => setForm({ ...form, category: e.target.value })}>
                      {categories.map((c) => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                  <div>
                    <label htmlFor="surface-length" className={labelStyle}>
                      Width / Length (feet) *
                    </label>
                    <input id="surface-length" type="number" min="0.01"
                      step="0.01" required className={inputStyle}
                      value={form.length} placeholder="20"
                      onChange={(e) => setForm({ ...form, length: e.target.value })} />
                  </div>
                  <div>
                    <label htmlFor="surface-height" className={labelStyle}>
                      Height / Depth (feet) *
                    </label>
                    <input id="surface-height" type="number" min="0.01"
                      step="0.01" required className={inputStyle}
                      value={form.height} placeholder="10"
                      onChange={(e) => setForm({ ...form, height: e.target.value })} />
                  </div>
                </div>

                <div className="rounded-2xl border border-gray-200 bg-[#FAFAFA] p-5">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-black">Doors & Windows</h3>
                      <p className="mt-1 text-sm text-gray-500">
                        Add openings only if their area should be excluded.
                      </p>
                    </div>
                    <button type="button" onClick={addOpening}
                      className="rounded-xl border-2 border-[#ED1C24] px-5 py-3 text-sm font-black text-[#ED1C24] hover:bg-red-50">
                      + ADD OPENING
                    </button>
                  </div>
                  {openings.length === 0 ? (
                    <p className="mt-5 rounded-xl bg-white p-4 text-sm text-gray-500">
                      No openings. The full surface area will be counted.
                    </p>
                  ) : (
                    <div className="mt-5 space-y-4">
                      {openings.map((opening, index) => (
                        <div key={opening.id}
                          className="rounded-xl border border-gray-200 bg-white p-4">
                          <div className="mb-3 flex items-center justify-between">
                            <strong>Opening {index + 1}</strong>
                            <button type="button"
                              onClick={() => setOpenings((old) =>
                                old.filter((o) => o.id !== opening.id)
                              )}
                              className="text-sm font-bold text-[#ED1C24]">
                              Remove
                            </button>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-4">
                            <div>
                              <label className={labelStyle}>Type</label>
                              <select className={inputStyle} value={opening.kind}
                                onChange={(e) => updateOpening(opening.id, {
                                  kind: e.target.value as Opening["kind"],
                                })}>
                                <option>Window</option>
                                <option>Door</option>
                                <option>Other</option>
                              </select>
                            </div>
                            <div>
                              <label className={labelStyle}>Quantity</label>
                              <input type="number" min="1" step="1"
                                required className={inputStyle}
                                value={opening.count}
                                onChange={(e) => updateOpening(opening.id, {
                                  count: Number(e.target.value),
                                })} />
                            </div>
                            <div>
                              <label className={labelStyle}>Width (ft)</label>
                              <input type="number" min="0.01" step="0.01"
                                required className={inputStyle}
                                value={opening.width}
                                onChange={(e) => updateOpening(opening.id, {
                                  width: Number(e.target.value),
                                })} />
                            </div>
                            <div>
                              <label className={labelStyle}>Height (ft)</label>
                              <input type="number" min="0.01" step="0.01"
                                required className={inputStyle}
                                value={opening.height}
                                onChange={(e) => updateOpening(opening.id, {
                                  height: Number(e.target.value),
                                })} />
                            </div>
                          </div>
                          <p className="mt-3 text-right text-sm font-bold text-gray-600">
                            Deduction: {formatArea(round(
                              opening.count * opening.width * opening.height
                            ))} sq ft
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-5">
                  <h3 className="mb-4 font-black">Live Area Calculation</h3>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div>
                      <p className="text-sm text-gray-600">Gross Area</p>
                      <p className="text-2xl font-black">
                        {formatArea(round(grossArea))} sq ft
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">Openings</p>
                      <p className="text-2xl font-black text-[#ED1C24]">
                        −{formatArea(round(deductedArea))} sq ft
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">Net Paintable Area</p>
                      <p className="text-2xl font-black">
                        {formatArea(round(netArea))} sq ft
                      </p>
                    </div>
                  </div>
                  {grossArea > 0 && deductedArea >= grossArea && (
                    <p className="mt-4 font-bold text-red-700">
                      Openings cannot equal or exceed the surface area.
                    </p>
                  )}
                </div>

                <div className="grid gap-5 sm:grid-cols-3">
                  <div>
                    <label htmlFor="condition" className={labelStyle}>
                      Surface Condition
                    </label>
                    <select id="condition" className={inputStyle}
                      value={form.condition}
                      onChange={(e) => setForm({ ...form, condition: e.target.value })}>
                      {["Good", "Fair", "Poor", "Damaged"].map((v) =>
                        <option key={v}>{v}</option>
                      )}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="preparation" className={labelStyle}>
                      Preparation
                    </label>
                    <select id="preparation" className={inputStyle}
                      value={form.preparation}
                      onChange={(e) => setForm({ ...form, preparation: e.target.value })}>
                      {["None", "Cleaning", "Sanding", "Scraping", "Patching",
                        "Priming", "Multiple Steps"].map((v) =>
                        <option key={v}>{v}</option>
                      )}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="coats" className={labelStyle}>Paint Coats</label>
                    <select id="coats" className={inputStyle}
                      value={form.coats}
                      onChange={(e) => setForm({ ...form, coats: e.target.value })}>
                      {[1, 2, 3, 4].map((n) => (
                        <option key={n} value={n}>{n} {n === 1 ? "Coat" : "Coats"}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label htmlFor="notes" className={labelStyle}>Surface Notes</label>
                  <textarea id="notes" className={`${inputStyle} min-h-28 resize-y`}
                    value={form.notes}
                    placeholder="Cracks, peeling paint, trim details, access issues..."
                    onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                </div>
                <div>
                  <label htmlFor="surface-photo" className={labelStyle}>
                    Surface Photo
                  </label>
                  <input id="surface-photo" type="file" accept="image/*"
                    capture="environment" onChange={handlePhoto}
                    className={inputStyle} />
                  <p className="mt-2 text-xs text-gray-500">
                    Take a photo or upload an image up to 20 MB. It will be resized and compressed automatically.
                    Photos are saved with the walkthrough in Supabase. Large images increase database usage.
                  </p>
                  {photo && (
                    <div className="mt-4">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={photo} alt="Surface preview"
                        className="max-h-72 w-full rounded-xl border border-gray-200 object-contain" />
                       <button type="button" disabled={analyzingPhoto || saving || uploadingPhoto || !photoPath}
                         onClick={analyzePhoto}
                         className="mt-4 w-full rounded-xl bg-[#252525] px-5 py-4 font-black text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-50">
                         {analyzingPhoto ? "ANALYZING PHOTO..." : "✦ ANALYZE PHOTO WITH AI"}
                       </button>
                       <p className="mt-2 text-xs text-gray-500">
                         AI observations are suggestions, not verified measurements. Review them before recording work.
                       </p>
                       {photoAnalysisError && (
                         <p role="alert" className="mt-3 rounded-xl bg-red-50 p-4 text-sm font-semibold text-red-800">
                           {photoAnalysisError}
                         </p>
                       )}
                       {photoAnalysis && (
                         <div className="mt-4 rounded-xl border border-yellow-200 bg-yellow-50 p-5">
                           <h3 className="font-black">AI Photo Review</h3>
                           <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-gray-800">{photoAnalysis}</p>
                           <p className="mt-3 text-xs text-gray-600">AI suggestions have been added to the form when available. Review the surface category, condition, preparation, coats, and notes. Enter measured dimensions yourself.</p>
                           <button type="button" onClick={applyAiSuggestions} disabled={!aiFindings}
                             className="mt-4 w-full rounded-xl bg-[#ED1C24] px-5 py-4 font-black text-white transition hover:bg-red-700">
                             REAPPLY AI SUGGESTIONS TO FORM
                           </button>
                         </div>
                       )}
                       <button type="button" onClick={() => {
                         setPhotoAnalysis("");
    setAiFindings(null);
                         setPhotoAnalysisError("");
                         setPhoto("");
                        const input = document.getElementById("surface-photo") as HTMLInputElement | null;
                        if (input) input.value = "";
                      }} className="mt-3 text-sm font-bold text-[#ED1C24]">
                        Remove Photo
                      </button>
                    </div>
                  )}
                </div>

                {message && (
                  <p role="status" className="rounded-xl bg-gray-100 p-4 text-sm font-bold">
                    {message}
                  </p>
                )}
                <button type="submit" disabled={saving || loadingSurfaces}
                  className="w-full rounded-xl bg-[#ED1C24] px-6 py-5 text-lg font-black text-white shadow-lg transition hover:bg-red-700">
                  {saving ? "SAVING..." : "+ SAVE PAINTING SURFACE"}
                </button>
              </div>
            </form>

             <section className="mt-10 rounded-2xl border border-gray-100 bg-white p-6 shadow-md">
               <div className="mb-4 flex items-center justify-between gap-3">
                 <div>
                   <h2 className="text-2xl font-black uppercase">Project Photos</h2>
                   <p className="mt-1 text-sm text-gray-500">Saved with this project for future estimates and PDFs. Removing a surface does not delete its photos.</p>
                 </div>
                 <span className="rounded-full bg-yellow-100 px-3 py-1 text-sm font-bold">{projectPhotos.length} photos</span>
               </div>
               {loadingPhotos && <p className="text-sm text-gray-500">Loading project photos...</p>}
               {photoGalleryError && <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{photoGalleryError}</p>}
               {!loadingPhotos && projectPhotos.length === 0 && !photoGalleryError && (
                 <p className="rounded-xl bg-gray-50 p-5 text-sm text-gray-600">No saved project photos yet. Upload a photo above to add it here automatically.</p>
               )}
               <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
                 {projectPhotos.map((item) => (
                   <a key={item.path} href={item.url} target="_blank" rel="noopener noreferrer"
                     className="block overflow-hidden rounded-xl border border-gray-200 hover:border-[#ED1C24]">
                     {/* eslint-disable-next-line @next/next/no-img-element */}
                     <img src={item.url} alt="Project photo" className="aspect-square w-full object-cover" />
                     <div className="p-2 text-xs text-gray-600">
                       {item.createdAt ? new Date(item.createdAt).toLocaleString() : "Saved photo"}
                     </div>
                   </a>
                 ))}
               </div>
               <p className="mt-4 text-xs text-gray-500">Photo links are temporary and private. Refresh the page to renew them when needed.</p>
             </section>

             <section className="mt-10">
               <div className="mb-6 flex items-center gap-3">
                <span className="h-1.5 w-12 bg-[#ED1C24]" />
                <h2 className="text-2xl font-black uppercase">Recorded Surfaces</h2>
              </div>
              {surfaces.length === 0 ? (
                <div className="rounded-2xl bg-white p-10 text-center shadow-md">
                  <p className="text-4xl">📐</p>
                  <h3 className="mt-4 text-xl font-black">No Surfaces Recorded</h3>
                  <p className="mt-3 text-gray-500">
                    Add your first painting surface above.
                  </p>
                </div>
              ) : (
                <div className="grid gap-5 lg:grid-cols-2">
                  {surfaces.map((surface) => (
                    <div key={surface.id}
                      className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-md">
                      {surface.photo && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={surface.photo} alt={surface.name}
                          className="h-56 w-full object-cover" />
                      )}
                      <div className="p-6">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="text-xs font-black uppercase tracking-wider text-[#ED1C24]">
                              {surface.category || "Uncategorized"}
                            </p>
                            <h3 className="mt-1 text-xl font-black">{surface.name}</h3>
                          </div>
                          <button type="button" onClick={() => deleteSurface(surface.id)}
                            className="text-sm font-bold text-[#ED1C24] hover:text-red-700">
                            Remove
                          </button>
                        </div>
                        <p className="mt-4 text-3xl font-black">
                          {formatArea(surface.squareFeet)}{" "}
                          <span className="text-base">sq ft net</span>
                        </p>
                        <p className="mt-2 text-sm text-gray-500">
                          {surface.length} ft × {surface.height} ft
                        </p>
                        <div className="mt-4 rounded-xl bg-gray-50 p-4 text-sm">
                          <p>Gross: {formatArea(surface.grossSquareFeet ?? surface.squareFeet)} sq ft</p>
                          <p>Openings deducted: {formatArea(surface.deductedSquareFeet ?? 0)} sq ft</p>
                          {(surface.openings ?? []).map((o) => (
                            <p key={o.id} className="mt-1 text-gray-500">
                              {o.count} × {o.kind} ({o.width} × {o.height} ft)
                            </p>
                          ))}
                        </div>
                        <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                          <p><strong>Condition:</strong> {surface.condition}</p>
                          <p><strong>Preparation:</strong> {surface.preparation}</p>
                          <p><strong>Coats:</strong> {surface.coats}</p>
                          <p><strong>Coated Area:</strong>{" "}
                            {formatArea(surface.squareFeet * surface.coats)} sq ft
                          </p>
                        </div>
                        {surface.notes && (
                          <p className="mt-5 rounded-xl bg-gray-50 p-4 text-sm leading-6 text-gray-600">
                            {surface.notes}
                          </p>
                        )}
                      </div>
                      <div className="h-1.5 bg-[#FFD400]" />
                    </div>
                  ))}
                </div>
              )}
            </section>
            <div className="mt-8">
              <Link href="/estimates"
                className="inline-flex rounded-xl bg-[#ED1C24] px-7 py-4 font-black text-white hover:bg-red-700">
                VIEW PROJECT ESTIMATE →
              </Link>
            </div>
          </>
        )}
      </section>

      {/* Approved Mercury footer */}
      <footer className="mt-12 border-t-4 border-[#FFD400] bg-white px-5 py-8">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-5">
          <div className="flex items-center gap-3">
            <div className="relative h-16 w-24">
              <Image src="/images/mercury-logo.png"
                alt="Mercury Painting Company" fill sizes="96px"
                className="object-contain" />
            </div>
            <div className="border-l-2 border-[#FFD400] pl-3">
              <p className="font-black text-[#ED1C24]">AI ESTIMATOR</p>
            </div>
          </div>
          <p className="text-xs text-gray-400">
            Developed by ECI — Emerald Coast Innovations
          </p>
        </div>
      </footer>
    </main>
  );
}
