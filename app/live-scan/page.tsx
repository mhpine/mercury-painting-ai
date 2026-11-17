
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { supabase } from "../lib/supabase";
import MercuryCamera from "../components/MercuryCamera";

const PHOTO_BUCKET = "mercury-project-photos";

type MercuryProject = {
  id: string;
  owner_id: string;
  name: string | null;
  customer_name: string | null;
  address: string | null;
};

export default function LiveScanPage() {
  const searchParams = useSearchParams();
const activeProjectId = searchParams.get("projectId");
  const savingRef = useRef(false);

  const [cameraVisible, setCameraVisible] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [projectId, setProjectId] = useState("");
  useEffect(() => {
  if (activeProjectId) {
    setProjectId(activeProjectId);
  }
}, [activeProjectId]);
  const [projects, setProjects] = useState<MercuryProject[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);

  const [savingPhoto, setSavingPhoto] = useState(false);

type InspectionFindings = {
  name: string;
  category: string;
  condition: string;
  preparation: string;
  coats: string;
  notes: string;
};

const [inspection, setInspection] = useState<{
  analysis: string;
  findings: InspectionFindings;
} | null>(null);

const [editingInspection, setEditingInspection] = useState(false);
const [approvedInspection, setApprovedInspection] = useState(false);
const [inspectionId, setInspectionId] = useState<string | null>(null);
// Recover the latest saved inspection for the selected project.
useEffect(() => {
  // Clear the previous project's report before loading another.
  setInspection(null);
  setInspectionId(null);
  setApprovedInspection(false);
  setEditingInspection(false);

  if (!projectId) return;

  let active = true;

  async function restoreInspection() {
    const { data, error } = await supabase
      .from("mercury_inspections")
      .select("id, analysis, findings, status")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!active) return;

    if (error) {
      setError(`Unable to restore inspection: ${error.message}`);
      return;
    }

    if (data) {
      setInspectionId(data.id);
      setInspection({
        analysis: data.analysis,
        findings: data.findings as InspectionFindings,
      });
      setApprovedInspection(data.status === "approved");
      setEditingInspection(false);
    }
  }

  void restoreInspection();

  return () => {
    active = false;
  };
}, [projectId]);


  useEffect(() => {
    let active = true;

    async function loadProjects() {
      const params = new URLSearchParams(window.location.search);
      const initialProjectId = params.get("projectId") ?? "";

      const { data, error } = await supabase
        .from("mercury_projects")
        .select("id, owner_id, name, customer_name, address")
        .order("name");

      if (!active) return;

      if (error) {
        setError(`Unable to load projects: ${error.message}`);
      } else {
        const availableProjects = data ?? [];
        setProjects(availableProjects);

        if (
          initialProjectId &&
          availableProjects.some(
            (project) => project.id === initialProjectId
          )
        ) {
          setProjectId(initialProjectId);
        }
      }

      setLoadingProjects(false);
    }

    void loadProjects();

    return () => {
      active = false;
    };
  }, []);
async function analyzeLiveScanPhoto(
  imageDataUrl: string,
  selectedProjectId: string
) {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError || !session?.access_token) {
    throw new Error("Please sign in before using AI analysis.");
  }

  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      projectId: selectedProjectId,
      imageDataUrl,
    }),
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(
      result.error || "Mercury AI analysis failed."
    );
  }

  return result as {
    analysis: string;
    findings: {
      name: string;
      category: string;
      condition: string;
      preparation: string;
      coats: string;
      notes: string;
    };
  };
}

  // Photo is supplied by the shared, fullscreen MercuryCamera component.
  // Keep this file responsible for project storage, AI analysis and approval.
  async function markPhoto(file: File): Promise<void> {
    if (savingRef.current) return;
    if (inspection && !approvedInspection) {
      setError("Review and approve the unfinished inspection before taking another photo.");
      return;
    }
    if (!projectId) {
      setError("Select a Mercury project before taking a photo.");
      return;
    }

    setError("");
    setMessage("");
    savingRef.current = true;
    setSavingPhoto(true);

    try {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !user) throw new Error("Please sign in to save project photos.");

      // The camera supplies a JPEG File; no second camera stream is opened here.
      const photoFile = file;
      const path = `${projectId}/${crypto.randomUUID()}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from(PHOTO_BUCKET)
        .upload(path, photoFile, { contentType: "image/jpeg", upsert: false });

      if (uploadError) throw new Error(`Photo upload failed: ${uploadError.message}`);

      setMessage("Photo saved! Mercury AI is analyzing the surface...");

      try {
        // Analyze a reduced copy without affecting the stored original.
        const image = await createImageBitmap(photoFile);
        const maxDimension = 1280;
        const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
        const aiCanvas = document.createElement("canvas");
        aiCanvas.width = Math.max(1, Math.round(image.width * scale));
        aiCanvas.height = Math.max(1, Math.round(image.height * scale));
        const ctx = aiCanvas.getContext("2d");
        if (!ctx) { image.close(); throw new Error("Unable to prepare photo for AI."); }
        ctx.drawImage(image, 0, 0, aiCanvas.width, aiCanvas.height);
        image.close();
        const result = await analyzeLiveScanPhoto(
          aiCanvas.toDataURL("image/jpeg", 0.7), projectId
        );

        const { data: savedInspection, error: inspectionSaveError } = await supabase
          .from("mercury_inspections")
          .insert({
            project_id: projectId,
            analysis: result.analysis,
            findings: { ...result.findings },
            status: "draft",
          })
          .select("id")
          .single();

        if (inspectionSaveError) {
          throw new Error(`Unable to save AI inspection: ${inspectionSaveError.message}`);
        }

        setInspection({ analysis: result.analysis, findings: { ...result.findings } });
        setInspectionId(savedInspection.id);
        setEditingInspection(false);
        setApprovedInspection(false);
        setMessage("Photo saved! AI inspection complete. Review the findings below.");
      } catch (aiError) {
        setMessage("Photo saved successfully, but AI analysis could not be completed.");
        setError(aiError instanceof Error ? aiError.message : "AI analysis failed.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save photo.");
    } finally {
      savingRef.current = false;
      setSavingPhoto(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 p-4 text-white">
      <div className="mx-auto max-w-4xl">
        <h1 className="mb-2 text-3xl font-bold">
          Mercury LiveScan — ROUTE FIX 1
        </h1>

        <p className="mb-5 text-slate-300">
          Live AI Painting Inspection
        </p>
        {/* LIVE_SCAN_NAV_V1: navigation only; protected camera and inspection flows unchanged. */}
        <nav aria-label="LiveScan navigation" className="mb-5 flex flex-wrap gap-3">
          <Link
            href={projectId ? `/walkthrough?projectId=${encodeURIComponent(projectId)}` : "/projects"}
            className="inline-flex min-h-12 items-center justify-center rounded-xl border border-slate-500 px-5 py-3 font-bold text-white hover:bg-slate-800"
          >
            â† BACK TO WALKTHROUGH
          </Link>
          <Link
            href={projectId ? `/estimates?projectId=${encodeURIComponent(projectId)}` : "/estimates"}
            className="inline-flex min-h-12 items-center justify-center rounded-xl bg-emerald-600 px-5 py-3 font-bold text-white hover:bg-emerald-700"
          >
            GO TO ESTIMATE â†’
          </Link>
        </nav>
{!activeProjectId && (
        <div className="mb-4 rounded-lg border border-slate-700 bg-slate-900 p-4">
          <label
            htmlFor="project-select"
            className="block text-sm font-semibold text-slate-200"
          >
            Select Mercury Project
          </label>

          <select
            id="project-select"
            value={projectId}
            onChange={(event) => {
  const nextProjectId = event.target.value;

  if (nextProjectId !== projectId) {
    setInspection(null);
    setEditingInspection(false);
    setApprovedInspection(false);

    // Remove the previous project's temporary report
    // from this browser before switching projects.
   
  }

  setProjectId(nextProjectId);
  setError("");
  setMessage("");
}}
            disabled={loadingProjects || savingPhoto}
            className="mt-2 w-full rounded-lg border border-slate-600 bg-slate-800 p-3 text-white"
          >
            <option value="">
              {loadingProjects
                ? "Loading projects..."
                : "Choose a project"}
            </option>

            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name || "Unnamed Project"}
                {project.customer_name
                  ? ` — ${project.customer_name}`
                  : ""}
                {project.address
                  ? ` — ${project.address}`
                  : ""}
              </option>
            ))}
          </select>

          {!loadingProjects && projects.length === 0 && (
            <p className="mt-2 text-sm text-amber-300">
              No accessible projects found. Create a project or
              check your account permissions.
            </p>
          )}

          {projectId && (
            <p className="mt-2 text-sm text-emerald-300">
              Project selected. Photos will be saved here.
            </p>
          )}
        </div>
)}
        {error && (
          <p role="alert" className="mt-4 rounded-lg bg-red-900 p-3 text-red-100">
            {error}
          </p>
        )}

        {message && (
          <p role="status" className="mt-4 rounded-lg bg-emerald-900 p-3 text-emerald-100">
            {message}
          </p>
        )}

        {/* Single entry to the fullscreen camera. Legacy inline preview has been removed. */}
        <div className="mt-5">
          <button
            type="button"
            disabled={!projectId || savingPhoto || Boolean(inspection && !approvedInspection)}
            onClick={() => setCameraVisible(true)}
            className="rounded-lg bg-amber-400 px-6 py-3 font-bold text-black disabled:cursor-not-allowed disabled:opacity-50"
          >
            OPEN FULLSCREEN CAMERA
          </button>
          {!projectId && <p className="mt-2 text-sm text-slate-300">Select a project first.</p>}
          {inspection && !approvedInspection && (
            <p className="mt-2 text-sm text-amber-300">Review and approve the current inspection to capture another surface.</p>
          )}
        </div>

        {cameraVisible && (
          <MercuryCamera
            disabled={!projectId || savingPhoto}
            onClose={() => setCameraVisible(false)}
            onCapture={async (file) => {
              // The source stream is owned by MercuryCamera and is closed by unmount.
              setCameraVisible(false);
              await markPhoto(file);
            }}
          />
        )}

{inspection && !approvedInspection && (
  <section className="mt-5 rounded-xl border border-emerald-500 bg-slate-900 p-4 shadow-xl">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-xl font-black text-white">
        🔍 MERCURY AI INSPECTION
      </h2>

      <span className={`rounded-full px-3 py-1 text-xs font-bold ${
        approvedInspection
          ? "bg-emerald-600 text-white"
          : "bg-amber-400 text-black"
      }`}>
        {approvedInspection ? "APPROVED" : "AWAITING REVIEW"}
      </span>
    </div>

    <p className="mb-4 text-sm text-slate-300">
      AI-generated suggestions. Verify conditions on site before approval.
    </p>

    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {(
        [
          ["name", "Surface"],
          ["category", "Category"],
          ["condition", "Condition"],
          ["preparation", "Preparation"],
          ["coats", "Recommended Coats"],
          ["notes", "Inspection Notes"],
        ] as const
      ).map(([field, label]) => (
        <div
          key={field}
          className="rounded-lg border border-slate-700 bg-slate-800 p-3"
        >
          <label className="mb-2 block text-xs font-bold uppercase text-amber-400">
            {label}
          </label>

          {editingInspection ? (
            <textarea
              value={inspection.findings[field]}
              onChange={(event) => {
                setInspection((current) =>
                  current
                    ? {
                        ...current,
                        findings: {
                          ...current.findings,
                          [field]: event.target.value,
                        },
                      }
                    : null
                );
                setApprovedInspection(false);
              }}
              rows={field === "notes" ? 3 : 2}
              className="w-full rounded-lg border border-slate-600 bg-slate-950 p-2 text-sm text-white"
            />
          ) : (
            <p className="whitespace-pre-wrap text-sm text-white">
              {inspection.findings[field] || "Not specified"}
            </p>
          )}
        </div>
      ))}
    </div>

    {inspection.analysis && (
      <div className="mt-4 rounded-lg bg-slate-800 p-3">
        <h3 className="mb-2 text-sm font-bold text-amber-400">
          AI Analysis
        </h3>
        <p className="whitespace-pre-wrap text-sm text-slate-200">
          {inspection.analysis}
        </p>
      </div>
    )}

    <div className="mt-5 flex flex-wrap gap-3">
      <button
        type="button"
        onClick={() => {
          setEditingInspection((current) => !current);
          setApprovedInspection(false);
        }}
        className="rounded-lg border border-amber-400 px-5 py-3 font-bold text-amber-400"
      >
        {editingInspection ? "DONE EDITING" : "✏️ EDIT FINDINGS"}
      </button>

      <button
        type="button"
        disabled={editingInspection || approvedInspection}
        onClick={async () => {
  if (!inspectionId || !inspection || !projectId) {
    setError("No saved inspection is available to approve.");
    return;
  }

  setError("");

  const { data, error } = await supabase
  
    .from("mercury_inspections")
    .update({
      findings: inspection.findings,
      analysis: inspection.analysis,
      status: "approved",
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", inspectionId)
.eq("project_id", projectId)
.select("id");

  if (error) {
    setError(`Unable to approve inspection: ${error.message}`);
    return;
  }
if (!data || data.length === 0) {
  setError("Inspection approval was not saved. Please try again.");
  return;
}

const { error: transferError } = await supabase.rpc(
  "mercury_add_approved_inspection",
  {
    p_inspection_id: inspectionId,
  }
);

if (transferError) {
  setError(
    `Inspection approved, but could not be added to the project: ${transferError.message}`
  );
  return;
}

setApprovedInspection(true);
setEditingInspection(false);
setMessage(
  "Inspection approved and saved to the project. Camera ready for the next surface."
);
}}
        className="rounded-lg bg-emerald-600 px-5 py-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {approvedInspection ? "✓ APPROVED" : "✓ APPROVE FINDINGS"}
      </button>
    </div>

    <p className="mt-3 text-xs text-slate-400">
      Approved findings are transferred to the project walkthrough when the save succeeds.
      Confirm surface measurements before calculating an estimate.
    </p>
  </section>
)}
      </div>
    </main>
  );
}
