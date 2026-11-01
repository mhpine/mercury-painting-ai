"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";

type Project = {
  id: string;
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
  photo?: string;
};

type Walkthrough = {
  projectId: string;
  surfaces: Surface[];
  updatedAt: string;
};

const STORAGE_KEY = "mercury_walkthroughs";
const PROJECTS_KEY = "mercury_projects";
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [surfaces, setSurfaces] = useState<Surface[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState(blankForm);
  const [openings, setOpenings] = useState<Opening[]>([]);
  const [photo, setPhoto] = useState("");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PROJECTS_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      const list = Array.isArray(parsed) ? (parsed as Project[]) : [];
      setProjects(list);
      if (list.length) {
        const requested = new URLSearchParams(window.location.search).get("projectId");
        setSelectedProjectId(
          requested && list.some((p) => p.id === requested) ? requested : list[0].id
        );
      }
    } catch (error) {
      console.error("Could not load projects", error);
      setMessage("Unable to read projects from this browser.");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!selectedProjectId) {
      setSurfaces([]);
      return;
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      const list = Array.isArray(parsed) ? (parsed as Walkthrough[]) : [];
      const saved = list.find((item) => item.projectId === selectedProjectId);
      setSurfaces(Array.isArray(saved?.surfaces) ? saved.surfaces : []);
    } catch (error) {
      console.error("Could not load walkthrough", error);
      setSurfaces([]);
      setMessage("Unable to read saved walkthrough.");
    }
  }, [selectedProjectId]);

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

  function saveSurfaces(updated: Surface[]) {
    if (!selectedProjectId) return false;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      const list = Array.isArray(parsed) ? (parsed as Walkthrough[]) : [];
      const next = list.filter((w) => w.projectId !== selectedProjectId);
      next.push({
        projectId: selectedProjectId,
        surfaces: updated,
        updatedAt: new Date().toISOString(),
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setSurfaces(updated);
      setMessage("Walkthrough saved successfully.");
      return true;
    } catch (error) {
      console.error("Could not save walkthrough", error);
      setMessage("Unable to save. Browser storage may be full; try a smaller photo.");
      return false;
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

  function addSurface(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProjectId) {
      setMessage("Select a project first.");
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
      photo: photo || undefined,
    };
    if (saveSurfaces([...surfaces, surface])) {
      setForm(blankForm());
      setOpenings([]);
      setPhoto("");
      const fileInput = document.getElementById("surface-photo") as HTMLInputElement | null;
      if (fileInput) fileInput.value = "";
    }
  }

  function deleteSurface(id: string) {
    if (window.confirm("Remove this surface from the walkthrough?")) {
      saveSurfaces(surfaces.filter((s) => s.id !== id));
    }
  }

  function handlePhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setMessage("Please choose an image.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setMessage("Choose an image under 2 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setPhoto(reader.result);
        setMessage("");
      }
    };
    reader.readAsDataURL(file);
  }

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
            {navigation.map((item) => (
              <Link key={item.href} href={item.href}
                className="border-b-4 border-transparent py-2 text-sm font-bold text-gray-600 transition hover:text-[#ED1C24]">
                {item.label}
              </Link>
            ))}
          </nav>
          <Link href="/projects/new"
            className="hidden rounded-xl bg-[#ED1C24] px-6 py-4 text-sm font-black text-white shadow-lg transition hover:bg-red-700 sm:inline-flex">
            + New Project
          </Link>
          <button type="button" onClick={() => setMenuOpen(!menuOpen)}
            aria-label={menuOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={menuOpen}
            className="rounded-xl border border-gray-200 px-4 py-3 text-xl lg:hidden">
            {menuOpen ? "✕" : "☰"}
          </button>
        </div>
        {menuOpen && (
          <nav className="absolute left-0 right-0 top-full border-t border-gray-200 bg-white p-5 shadow-xl lg:hidden">
            {[...navigation,
              { label: "AI Walkthrough", href: "/walkthrough" },
              { label: "New Project", href: "/projects/new" },
            ].map((item) => (
              <Link key={item.href} href={item.href}
                onClick={() => setMenuOpen(false)}
                className="block rounded-xl px-4 py-4 font-bold hover:bg-red-50 hover:text-[#ED1C24]">
                {item.label}
              </Link>
            ))}
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
              <p className="font-bold">No projects have been created yet.</p>
              <Link href="/projects/new"
                className="mt-4 inline-flex rounded-xl bg-[#ED1C24] px-5 py-3 font-black text-white">
                + Create First Project
              </Link>
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
              {selectedProject && (
                <p className="mt-4 text-sm text-gray-500">
                  📍 {selectedProject.address}
                </p>
              )}
            </>
          )}
        </div>

        {selectedProject && (
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
                    Take a photo or upload an image under 2 MB.
                    Photos are stored in this browser, not uploaded to a server.
                  </p>
                  {photo && (
                    <div className="mt-4">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={photo} alt="Surface preview"
                        className="max-h-72 w-full rounded-xl border border-gray-200 object-contain" />
                      <button type="button" onClick={() => {
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
                <button type="submit"
                  className="w-full rounded-xl bg-[#ED1C24] px-6 py-5 text-lg font-black text-white shadow-lg transition hover:bg-red-700">
                  + SAVE PAINTING SURFACE
                </button>
              </div>
            </form>

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
