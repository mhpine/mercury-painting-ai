"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { supabase } from "../lib/supabase";

// Opt-in Project Records laboratory. No existing camera, Walkthrough, or estimate route is modified.
const PHOTO_BUCKET = "mercury-project-photos";
const TEXTURES = ["Not assessed", "Smooth", "Light texture", "Medium texture", "Heavy texture", "Uncertain — retake close-up"];

type Project = { id: string; ownerId: string; name: string; address: string };
type Photo = { path: string; name: string; url: string; createdAt: string | null };
type Surface = { id: string; name: string; category?: string; photoPath?: string };
type Findings = Record<string, unknown>;
type Report = {
  id: string;
  project_id: string;
  photo_path: string;
  surface_id: string | null;
  surface_name: string | null;
  analysis_text: string;
  ai_findings: Findings;
  created_at: string;
};
type Status = "pending" | "approved" | "needs_correction";
type Review = {
  id: string;
  report_id: string;
  status: Status;
  confirmed_texture: string;
  notes: string;
  created_at: string;
};
type UnsavedResult = { projectId: string; photoPath: string; surfaceName: string | null; analysis: string; findings: Findings; createdAt: string };

function friendlyDate(value: string | null | undefined) {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : value;
}
function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Photo conversion failed."));
    reader.onerror = () => reject(new Error("Unable to read this photo."));
    reader.readAsDataURL(blob);
  });
}

export default function ProjectRecordsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [surfaces, setSurfaces] = useState<Surface[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [selectedPhotoPath, setSelectedPhotoPath] = useState("");
  const [surfaceId, setSurfaceId] = useState("");
  const [activeReportId, setActiveReportId] = useState("");
  const [status, setStatus] = useState<Status>("pending");
  const [texture, setTexture] = useState("Not assessed");
  const [reviewNotes, setReviewNotes] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [schemaReady, setSchemaReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [unsaved, setUnsaved] = useState<UnsavedResult | null>(null);

  useEffect(() => {
    let live = true;
    async function loadProjects() {
      setLoadingProjects(true);
      setError("");
      try {
        const { data: userData, error: userError } = await supabase.auth.getUser();
        if (userError || !userData.user) throw new Error("Sign in to Mercury before opening Project Records.");
        const userId = userData.user.id;
        const { data: employee, error: employeeError } = await supabase
          .from("mercury_employees").select("role, status").eq("user_id", userId).maybeSingle();
        if (employeeError || employee?.status !== "approved") throw new Error("Your Mercury employee account is not approved.");

        const { data: rows, error: projectError } = await supabase
          .from("mercury_projects").select("id, owner_id, name, customer_name, address, project_data").order("name");
        if (projectError) throw projectError;
        let editShares = new Set<string>();
        if (employee.role !== "admin") {
          const { data: shares, error: shareError } = await supabase
            .from("mercury_project_shares").select("project_id")
            .eq("shared_with", userId).eq("permission", "edit");
          if (shareError) throw shareError;
          editShares = new Set((shares ?? []).map((s) => String(s.project_id)));
        }
        const visible: Project[] = (rows ?? [])
          .filter((row) => employee.role === "admin" ? row.owner_id === userId : editShares.has(String(row.id)))
          .map((row) => {
            const extra = row.project_data && typeof row.project_data === "object" && !Array.isArray(row.project_data)
              ? row.project_data as Record<string, unknown> : {};
            return {
              id: String(row.id), ownerId: String(row.owner_id),
              name: String(row.customer_name || extra.customerName || row.name || "Project"),
              address: String(row.address || extra.address || ""),
            };
          });
        if (!live) return;
        setProjects(visible);
        const requested = new URLSearchParams(window.location.search).get("projectId");
        setProjectId(requested && visible.some((p) => p.id === requested) ? requested : visible[0]?.id ?? "");
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : "Unable to load projects.");
      } finally {
        if (live) setLoadingProjects(false);
      }
    }
    void loadProjects();
    return () => { live = false; };
  }, []);

  useEffect(() => {
    let live = true;
    setPhotos([]);
    setSurfaces([]);
    setReports([]);
    setReviews([]);
    setSelectedPhotoPath("");
    setSurfaceId("");
    setActiveReportId("");
    setUnsaved(null);
    setSchemaReady(false);
    if (!projectId) return () => { live = false; };

    async function loadProjectRecords() {
      setLoadingRecords(true);
      setError("");
      setMessage("");
      const notices: string[] = [];
      try {
        const { data: gallery, error: galleryError } = await supabase.storage.from(PHOTO_BUCKET)
          .list(projectId, { limit: 1000, sortBy: { column: "created_at", order: "desc" } });
        if (galleryError) {
          notices.push(`Photo library: ${galleryError.message}`);
        } else {
          const files = (gallery ?? []).filter((item) => /\.(jpg|jpeg|png|webp)$/i.test(item.name));
          const found: Photo[] = [];
          for (let offset = 0; offset < files.length; offset += 50) {
            const subset = files.slice(offset, offset + 50);
            const paths = subset.map((item) => `${projectId}/${item.name}`);
            const { data: signed, error: signedError } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 3600);
            if (signedError) { notices.push(`Photo previews: ${signedError.message}`); break; }
            subset.forEach((item, i) => {
              if (signed?.[i]?.signedUrl) {
                found.push({ path: paths[i], name: item.name, url: signed[i].signedUrl, createdAt: item.created_at ?? null });
              }
            });
          }
          if (live) {
            setPhotos(found);
            setSelectedPhotoPath(found[0]?.path ?? "");
          }
          if (files.length >= 1000) notices.push("Showing the first 1,000 project photos; pagination will be added later.");
        }

        const { data: walkthrough, error: walkthroughError } = await supabase
          .from("mercury_walkthroughs").select("walkthrough_data").eq("project_id", projectId).maybeSingle();
        if (walkthroughError) notices.push(`Surfaces: ${walkthroughError.message}`);
        else {
          const payload = walkthrough?.walkthrough_data as { surfaces?: Surface[] } | null;
          if (live) setSurfaces(Array.isArray(payload?.surfaces) ? payload.surfaces.filter((s) => !!s.id) : []);
        }

        const { data: saved, error: reportError } = await supabase
          .from("mercury_inspection_reports")
          .select("id,project_id,photo_path,surface_id,surface_name,analysis_text,ai_findings,created_at")
          .eq("project_id", projectId).order("created_at", { ascending: false }).limit(100);
        if (reportError) {
          notices.push("Saved reports are unavailable until the additive Supabase SQL setup is completed (or your project permissions are verified).");
        } else {
          if (live) {
            setSchemaReady(true);
            const fetched = (saved ?? []) as Report[];
            setReports(fetched);
            setActiveReportId(fetched[0]?.id ?? "");
          }
          const ids = (saved ?? []).map((r) => r.id);
          if (ids.length) {
            const { data: history, error: reviewError } = await supabase
              .from("mercury_inspection_reviews")
              .select("id,report_id,status,confirmed_texture,notes,created_at")
              .in("report_id", ids).order("created_at", { ascending: false }).limit(500);
            if (reviewError) {
              notices.push("Review history is unavailable; check that both Supabase tables were created.");
              if (live) setSchemaReady(false);
            } else if (live) setReviews((history ?? []) as Review[]);
          } else {
            // Confirm the second table exists, even when no reports are present.
            const { error: reviewCheck } = await supabase.from("mercury_inspection_reviews").select("id").limit(1);
            if (reviewCheck) {
              notices.push("Review history table is unavailable; run the supplied SQL before using AI analysis.");
              if (live) setSchemaReady(false);
            }
          }
        }
      } catch (e) {
        notices.push(e instanceof Error ? e.message : "Project records could not be loaded.");
      } finally {
        if (live) {
          if (notices.length) setError(notices.join(" "));
          setLoadingRecords(false);
        }
      }
    }
    void loadProjectRecords();
    return () => { live = false; };
  }, [projectId, reload]);

  const selectedProject = projects.find((p) => p.id === projectId);
  const selectedPhoto = photos.find((p) => p.path === selectedPhotoPath);
  const selectedSurface = surfaces.find((s) => s.id === surfaceId);
  const activeReport = reports.find((r) => r.id === activeReportId);
  const reportReviews = useMemo(() => reviews.filter((r) => r.report_id === activeReportId), [reviews, activeReportId]);
  const latestReview = reportReviews[0];
  const activePhotoUrl = photos.find((p) => p.path === activeReport?.photo_path)?.url;

  useEffect(() => {
    setStatus(latestReview?.status ?? "pending");
    setTexture(latestReview?.confirmed_texture ?? "Not assessed");
    setReviewNotes(latestReview?.notes ?? "");
  }, [activeReportId, latestReview?.id, latestReview?.status, latestReview?.confirmed_texture, latestReview?.notes]);

  async function analyzeAndSave() {
    if (!selectedPhoto || !projectId || busy || !schemaReady) return;
    const currentProject = projectId;
    const chosenPhoto = selectedPhoto.path;
    const currentSurface = selectedSurface ? { id: selectedSurface.id, name: selectedSurface.name } : null;
    setBusy(true);
    setError("");
    setMessage("Analyzing the selected photo. The original AI findings will be saved as a permanent record.");
    setUnsaved(null);
    try {
      const { data: auth, error: authError } = await supabase.auth.getSession();
      const token = auth.session?.access_token;
      if (authError || !token) throw new Error("Sign in before running an AI inspection.");
      const { data: imageBlob, error: imageError } = await supabase.storage.from(PHOTO_BUCKET).download(chosenPhoto);
      if (imageError || !imageBlob) throw new Error(imageError?.message ?? "Unable to retrieve the photo from project storage.");
      if (imageBlob.size > 15 * 1024 * 1024) throw new Error("This photo is too large for AI inspection. Choose a smaller saved image.");
      const imageDataUrl = await blobToDataUrl(imageBlob);
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ projectId: currentProject, imageDataUrl }),
      });
      const result = await response.json() as { analysis?: string; findings?: Findings; error?: string };
      if (!response.ok) throw new Error(result.error || `AI analysis failed (${response.status}).`);
      if (!result.analysis?.trim() && !result.findings) throw new Error("AI returned no findings. No report was saved.");
      const analysis = result.analysis || "Structured AI findings returned; see details below.";
      const findings = result.findings ?? {};
      const pending: UnsavedResult = {
        projectId: currentProject, photoPath: chosenPhoto,
        surfaceName: currentSurface?.name ?? null, analysis, findings, createdAt: new Date().toISOString(),
      };
      const { error: insertError } = await supabase.from("mercury_inspection_reports").insert({
        project_id: currentProject,
        photo_path: chosenPhoto,
        surface_id: currentSurface?.id ?? null,
        surface_name: currentSurface?.name ?? null,
        analysis_text: analysis,
        ai_findings: findings,
      });
      if (insertError) {
        setUnsaved(pending);
        throw new Error(`AI analysis succeeded, but saving the permanent record failed: ${insertError.message}. Download the recovery JSON below before leaving.`);
      }
      setMessage("AI inspection saved permanently. Reopen it in the report archive and record your review.");
      setReload((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Inspection could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  async function addReview() {
    if (!activeReport || busy || !schemaReady) return;
    setBusy(true);
    setError("");
    try {
      const { error: insertError } = await supabase.from("mercury_inspection_reviews").insert({
        report_id: activeReport.id,
        status,
        confirmed_texture: texture,
        notes: reviewNotes.trim().slice(0, 4000),
      });
      if (insertError) throw insertError;
      setMessage("Review saved as a new history entry. Original AI findings were not altered.");
      setReload((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the review.");
    } finally { setBusy(false); }
  }


  // Project Records only: remove an unlinked photo from the selected project's Storage folder.
  // Never modify recorded surfaces, archived reports, or the existing camera/estimate flows.
  async function removeSelectedPhoto() {
    if (!selectedPhoto || !projectId || busy || loadingRecords) return;
    const currentProjectId = projectId;
    const chosenPath = selectedPhoto.path;
    if (!projects.some((project) => project.id === currentProjectId) ||
        !photos.some((item) => item.path === chosenPath)) {
      setError("Select a photo in a project you can access before deleting.");
      return;
    }
    // Avoid passing arbitrary object paths to Storage.remove.
    const prefix = `${currentProjectId}/`;
    const filename = chosenPath.startsWith(prefix) ? chosenPath.slice(prefix.length) : "";
    if (!filename || filename.includes("/") || filename.includes("\\") ||
        !/\.(jpe?g|png|webp)$/i.test(filename)) {
      setError("Invalid project photo path. No photo was deleted.");
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (unsaved?.photoPath === chosenPath) {
        throw new Error("This photo has unsaved AI findings. Save or export those findings before removing the photo.");
      }

      // Re-read stored surfaces instead of trusting the loaded first-page list.
      const { data: walkthrough, error: walkthroughError } = await supabase
        .from("mercury_walkthroughs")
        .select("walkthrough_data")
        .eq("project_id", currentProjectId)
        .maybeSingle();
      if (walkthroughError) throw new Error(`Could not verify surface photo links: ${walkthroughError.message}`);
      // Guard against photoPath and any additional photo references in the saved surface data.
      if (JSON.stringify(walkthrough?.walkthrough_data ?? {}).includes(JSON.stringify(chosenPath))) {
        throw new Error("This photo is linked to a recorded surface. It must be detached from that surface before permanent deletion.");
      }

      // Report history may have more than the 100 records shown on the screen.
      const { data: linkedReports, error: reportError } = await supabase
        .from("mercury_inspection_reports")
        .select("id")
        .eq("project_id", currentProjectId)
        .eq("photo_path", chosenPath)
        .limit(1);
      if (reportError) {
        // Before the additive archive migration, this new table cannot contain reports.
        // Any other error (including permissions) MUST block deletion.
        if (!["PGRST205", "42P01"].includes(reportError.code ?? "")) {
          throw new Error(`Could not verify archived AI report links: ${reportError.message}`);
        }
      } else if ((linkedReports ?? []).length > 0) {
        throw new Error("This photo belongs to a saved AI inspection report. It cannot be permanently deleted from the library.");
      }

      const confirmed = window.confirm(
        `Permanently delete this photo from the project?\n\n${filename}\n\n` +
        "This removes the original image from Supabase Storage, not just this page. " +
        "Older LiveScan inspections may not identify their source photo. " +
        "Keep a copy if you may need the image later. This cannot be undone."
      );
      if (!confirmed) return;

      // Existing Storage RLS must authorize the deletion. Do not relax policies here.
      const { error: deleteError } = await supabase.storage.from(PHOTO_BUCKET).remove([chosenPath]);
      if (deleteError) throw new Error(`Photo deletion was not permitted or failed: ${deleteError.message}`);
      const remaining = photos.filter((item) => item.path !== chosenPath);
      setPhotos((current) => current.filter((item) => item.path !== chosenPath));
      setSelectedPhotoPath((current) => current === chosenPath ? (remaining[0]?.path ?? "") : current);
      setMessage("Photo deleted from the project library. All surfaces, AI reports and estimates were left unchanged.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to remove the selected photo. Nothing else was changed.");
    } finally {
      setBusy(false);
    }
  }

  function exportReport() {
    if (!activeReport) return;
    downloadJson({
      project: selectedProject,
      report: activeReport,
      reviewHistory: reportReviews,
      exportedAt: new Date().toISOString(),
    }, `mercury-inspection-${activeReport.id.slice(0, 8)}.json`);
  }

  return (
    <main className="min-h-screen bg-[#f4f5f7] text-[#252525]">
      <header className="mercury-hide-print border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-3">
          <Link href="/" className="flex items-center gap-3">
            <span className="relative block h-16 w-28 sm:h-20 sm:w-44">
              <Image src="/images/mercury-logo.png" alt="Mercury Painting Company" fill sizes="(max-width: 640px) 112px, 176px" className="object-contain object-left" />
            </span>
            <span className="border-l-4 border-[#ffd400] pl-3 text-base font-black text-[#ed1c24] sm:text-xl">AI ESTIMATOR</span>
          </Link>
          <div className="flex flex-wrap gap-2 text-xs font-bold sm:text-sm">
            <Link href={`/walkthrough${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`} className="rounded-full border border-gray-300 px-4 py-2 hover:bg-gray-50">Walkthrough</Link>
            <Link href={`/estimates${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`} className="rounded-full border border-gray-300 px-4 py-2 hover:bg-gray-50">Estimates</Link>
          </div>
        </div>
      </header>

      <section className="mercury-hide-print mx-auto max-w-7xl space-y-5 px-5 py-7">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.15em] text-[#ed1c24]">Field records · isolated preview</p>
          <h1 className="mt-2 text-3xl font-black sm:text-4xl">Project Photos & AI Reports</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">
            Reopen saved project photographs, connect an inspection to a recorded surface, and preserve the AI findings separately from your corrections.
            This page does not change LiveScan, MARK, Walkthrough measurements, or estimates.
          </p>
        </div>
        {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">{error}</div>}
        {message && <div role="status" className="rounded-xl border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm font-medium text-gray-800">{message}</div>}
        {!schemaReady && !loadingRecords && !!projectId && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
            <strong>Database setup required:</strong> Run the supplied additive SQL for the two new inspection tables in the correct Supabase test environment.
            AI analysis is disabled here until reports can be safely saved. Existing Mercury features are unaffected.
          </div>
        )}
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <label htmlFor="record-project" className="mb-2 block text-sm font-black">Painting Project</label>
          <select id="record-project" value={projectId} disabled={loadingProjects || busy} onChange={(e) => setProjectId(e.target.value)} className="w-full rounded-lg border border-gray-300 p-3">
            {loadingProjects && <option value="">Loading projects…</option>}
            {!loadingProjects && !projects.length && <option value="">No accessible projects</option>}
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}{p.address ? ` — ${p.address}` : ""}</option>)}
          </select>
          <p className="mt-2 text-xs text-gray-500">Use a dedicated test project. Preview may share data with Production Supabase.</p>
        </div>
      </section>

      {projectId && <section className="mercury-hide-print mx-auto grid max-w-7xl gap-5 px-5 pb-8 lg:grid-cols-[1.15fr_1fr]">
        <div className="space-y-5">
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-xl font-black">Project Photo Library</h2>
              <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-black">{photos.length} photos</span>
            </div>
            <p className="mb-4 text-sm text-gray-600">These are existing photos already saved to the selected project. No re-upload is needed.</p>
            {loadingRecords && <p className="text-sm text-gray-500">Loading project records…</p>}
            {!loadingRecords && photos.length === 0 && <p className="rounded-xl bg-gray-50 p-4 text-sm text-gray-600">No photos found. Capture them in Mercury's existing camera first; they will appear here when saved to this project.</p>}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {photos.map((p) => (
                <button key={p.path} type="button" onClick={() => setSelectedPhotoPath(p.path)} disabled={busy}
                  aria-pressed={selectedPhotoPath === p.path} aria-label={`Choose photo ${p.name}`}
                  className={`overflow-hidden rounded-xl border-4 text-left transition ${selectedPhotoPath === p.path ? "border-[#ed1c24]" : "border-transparent hover:border-gray-300"}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={`Project photo ${p.name}`} className="aspect-[4/3] w-full bg-gray-100 object-cover" />
                  <span className="block truncate px-1 py-2 text-[11px] text-gray-600">{friendlyDate(p.createdAt)}</span>
                </button>
              ))}
            </div>
            {selectedPhoto && (
              <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-black uppercase tracking-wide text-gray-500">Selected photo</p>
                    <p className="truncate text-sm font-semibold" title={selectedPhoto.name}>{selectedPhoto.name}</p>
                  </div>
                  <button type="button" onClick={() => void removeSelectedPhoto()}
                    disabled={busy || loadingRecords}
                    className="rounded-lg border-2 border-red-600 px-4 py-3 text-sm font-black text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40">
                    {busy ? "WORKING…" : "DELETE PHOTO"}
                  </button>
                </div>
                <p className="mt-2 text-xs leading-5 text-gray-600">
                  Permanent deletion requires confirmation. Photos assigned to a recorded surface or saved AI report are protected.
                  Older LiveScan reports may not track the source photo. Keep an independent copy of important images.
                </p>
              </div>
            )}
          </div>
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-xl font-black">New AI Inspection</h2>
            {selectedPhoto && <div className="mb-3 rounded-xl bg-gray-50 p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={selectedPhoto.url} alt="Selected inspection photo" className="max-h-72 w-full rounded-lg object-contain" />
              <p className="mt-2 break-all text-xs text-gray-600">{selectedPhoto.name}</p>
            </div>}
            <label htmlFor="record-surface" className="mb-2 block text-sm font-black">Link to Recorded Surface</label>
            <select id="record-surface" value={surfaceId} disabled={busy} onChange={(e) => setSurfaceId(e.target.value)} className="w-full rounded-lg border border-gray-300 p-3 text-sm">
              <option value="">Unassigned / whole project</option>
              {surfaces.map((s) => <option key={s.id} value={s.id}>{s.name}{s.category ? ` (${s.category})` : ""}</option>)}
            </select>
            <p className="mt-2 text-xs text-gray-500">The report will be linked to this surface. Surface measurements and existing photo assignments are not changed.</p>
            <button type="button" disabled={!schemaReady || !selectedPhoto || busy || loadingRecords} onClick={() => void analyzeAndSave()}
              className="mt-4 w-full rounded-xl bg-[#252525] px-5 py-4 text-sm font-black text-white hover:bg-black disabled:cursor-not-allowed disabled:opacity-40">
              {busy ? "WORKING…" : "ANALYZE SELECTED PHOTO & SAVE REPORT"}
            </button>
            <p className="mt-2 text-xs text-gray-500">AI observations are not verified measurements. Confirm texture and defects on site; photograph texture close-up if uncertain.</p>
            {unsaved && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4">
              <p className="mb-2 text-sm font-bold text-red-800">Unsaved AI findings — download a recovery copy before leaving this page.</p>
              <button type="button" onClick={() => downloadJson(unsaved, "mercury-unsaved-inspection-recovery.json")} className="rounded-lg border border-red-400 px-4 py-2 text-sm font-bold">Download recovery JSON</button>
            </div>}
          </div>
        </div>
        <div className="space-y-5">
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-xl font-black">Saved AI Reports</h2>
              <span className="rounded-full bg-yellow-100 px-3 py-1 text-xs font-black">{reports.length}</span>
            </div>
            <p className="mb-4 text-sm text-gray-600">Reopen reports whenever you return to this project. The original AI analysis stays unchanged.</p>
            {reports.length === 0 && !loadingRecords && <p className="rounded-lg bg-gray-50 p-4 text-sm text-gray-500">No saved inspection reports yet.</p>}
            <div className="max-h-[370px] space-y-2 overflow-y-auto">
              {reports.map((r) => {
                const review = reviews.find((item) => item.report_id === r.id);
                return <button key={r.id} type="button" onClick={() => setActiveReportId(r.id)}
                  className={`w-full rounded-xl border p-3 text-left ${r.id === activeReportId ? "border-[#ed1c24] bg-red-50" : "border-gray-200 hover:bg-gray-50"}`}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-black">{r.surface_name || "Unassigned inspection"}</span>
                    <span className="text-[10px] font-bold uppercase text-gray-500">{(review?.status || "pending").replaceAll("_", " ")}</span>
                  </div>
                  <span className="mt-1 block text-xs text-gray-600">{friendlyDate(r.created_at)}</span>
                </button>;
              })}
            </div>
          </div>
        </div>
      </section>}

      {activeReport && <section className="mercury-report-sheet mx-auto max-w-7xl px-5 pb-12">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-7">
          <div className="mercury-hide-print mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xl font-black">Inspection Report Detail</h2>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={exportReport} className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-bold">Download Report JSON</button>
              <button type="button" onClick={() => window.print()} className="rounded-lg bg-[#ed1c24] px-3 py-2 text-xs font-bold text-white">Print / Save PDF</button>
            </div>
          </div>
          <div className="mb-5 border-b border-gray-200 pb-4">
            <h2 className="text-2xl font-black">Mercury AI Inspection Report</h2>
            <p className="mt-2 text-sm">Project: <strong>{selectedProject?.name ?? activeReport.project_id}</strong></p>
            <p className="text-sm">Surface: <strong>{activeReport.surface_name || "Unassigned"}</strong></p>
            <p className="text-sm">Inspected: {friendlyDate(activeReport.created_at)}</p>
            <p className="text-sm">Current review: <strong>{(latestReview?.status || "pending").replaceAll("_", " ")}</strong></p>
            <p className="text-sm">Confirmed texture: <strong>{latestReview?.confirmed_texture || "Not assessed"}</strong></p>
          </div>
          {activePhotoUrl ? <div className="mb-5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={activePhotoUrl} alt="Photo associated with AI inspection" className="max-h-96 w-full rounded-lg bg-gray-50 object-contain" />
          </div> : <p className="mb-5 rounded-lg bg-gray-50 p-3 text-sm text-gray-600">Original photo is not available in the current gallery. It may have been removed from storage.</p>}
          <h3 className="mb-2 text-base font-black">Original AI observations (unaltered)</h3>
          <p className="whitespace-pre-wrap rounded-lg bg-gray-50 p-4 text-sm leading-6">{activeReport.analysis_text}</p>
          <h3 className="mb-2 mt-5 text-base font-black">Original structured findings</h3>
          <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-4 text-xs leading-5">{JSON.stringify(activeReport.ai_findings ?? {}, null, 2)}</pre>
          <h3 className="mb-2 mt-5 text-base font-black">Painter review history</h3>
          {reportReviews.length === 0 && <p className="text-sm text-gray-500">No painter review yet. AI findings are unverified.</p>}
          {reportReviews.map((r) => <div key={r.id} className="mb-2 rounded-lg border border-gray-200 p-3 text-sm">
            <p className="font-bold">{r.status.replaceAll("_", " ")} · {r.confirmed_texture}</p>
            <p className="text-xs text-gray-500">{friendlyDate(r.created_at)}</p>
            {r.notes && <p className="mt-2 whitespace-pre-wrap">{r.notes}</p>}
          </div>)}
          <div className="mercury-hide-print mt-6 rounded-xl border border-yellow-200 bg-yellow-50 p-4">
            <h3 className="mb-3 font-black">Add a new painter review</h3>
            <label htmlFor="review-status" className="mb-1 block text-sm font-bold">Verification status</label>
            <select id="review-status" value={status} onChange={(e) => setStatus(e.target.value as Status)} className="mb-3 w-full rounded-lg border border-gray-300 bg-white p-3 text-sm">
              <option value="pending">Pending field verification</option>
              <option value="approved">Verified / approved</option>
              <option value="needs_correction">AI findings require correction</option>
            </select>
            <label htmlFor="review-texture" className="mb-1 block text-sm font-bold">Actual surface texture (painter-confirmed)</label>
            <select id="review-texture" value={texture} onChange={(e) => setTexture(e.target.value)} className="mb-3 w-full rounded-lg border border-gray-300 bg-white p-3 text-sm">
              {TEXTURES.map((t) => <option key={t}>{t}</option>)}
            </select>
            <label htmlFor="review-notes" className="mb-1 block text-sm font-bold">Field notes / corrections</label>
            <textarea id="review-notes" value={reviewNotes} maxLength={4000} onChange={(e) => setReviewNotes(e.target.value)} rows={4}
              placeholder="Example: AI said smooth; close-up confirms medium-textured stucco. Needs additional paint coverage."
              className="w-full rounded-lg border border-gray-300 bg-white p-3 text-sm" />
            <button type="button" disabled={busy || !schemaReady} onClick={() => void addReview()} className="mt-3 w-full rounded-xl bg-[#ed1c24] p-3 text-sm font-black text-white disabled:opacity-40">
              SAVE REVIEW TO HISTORY
            </button>
            <p className="mt-2 text-xs text-gray-600">Each review creates a new dated entry. Original AI findings are never overwritten.</p>
          </div>
        </div>
      </section>}
      <footer className="mercury-hide-print border-t-4 border-[#ffd400] bg-white px-5 py-6 text-center text-xs text-gray-500">
        Mercury Painting AI Estimator · Developed by ECI — Emerald Coast Innovations · Project Records Preview
      </footer>
      <style>{`@media print { .mercury-hide-print { display: none !important; } .mercury-report-sheet { display: block !important; max-width: 100% !important; padding: 0 !important; } body { background: white !important; } }`}</style>
    </main>
  );
}
