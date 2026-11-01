"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";

type Project = {
  id: string;
  customerName: string;
  companyName?: string;
  address: string;
  phone?: string;
  email?: string;
  paintingType?: string;
  projectType?: string;
};

type Surface = {
  id: string;
  name: string;
  squareFeet: number;
  coats: number;
  condition: string;
  preparation: string;
};

type Walkthrough = {
  projectId: string;
  surfaces: Surface[];
};

type Rates = {
  coverage: number;
  paintPrice: number;
  laborRate: number;
  prepRate: number;
  wastePercent: number;
  markupPercent: number;
};

const DEFAULT_RATES: Rates = {
  coverage: 350,
  paintPrice: 45,
  laborRate: 1.5,
  prepRate: 0.35,
  wastePercent: 10,
  markupPercent: 15,
};

const navigation = [
  { label: "Dashboard", href: "/" },
  { label: "Projects", href: "/projects" },
  { label: "Estimates", href: "/estimates" },
  { label: "Settings", href: "/settings" },
];

function money(value: number) {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

export default function EstimatesPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [walkthroughs, setWalkthroughs] = useState<Walkthrough[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [rates, setRates] = useState<Rates>(DEFAULT_RATES);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    try {
      const savedProjects = JSON.parse(
        localStorage.getItem("mercury_projects") || "[]"
      );

      const savedWalkthroughs = JSON.parse(
        localStorage.getItem("mercury_walkthroughs") || "[]"
      );

      const savedRates = JSON.parse(
        localStorage.getItem("mercury_estimate_rates") || "null"
      );

      const projectList: Project[] = Array.isArray(savedProjects)
        ? savedProjects
        : [];

      setProjects(projectList);

      setWalkthroughs(
        Array.isArray(savedWalkthroughs) ? savedWalkthroughs : []
      );

      if (savedRates && typeof savedRates === "object") {
        setRates({
          ...DEFAULT_RATES,
          ...savedRates,
        });
      }

      if (projectList.length > 0) {
        setSelectedId(projectList[0].id);
      }
    } catch (error) {
      console.error("Unable to load estimate data:", error);
    } finally {
      setLoaded(true);
    }
  }, []);

  const project = projects.find((item) => item.id === selectedId);

  const walkthrough = walkthroughs.find(
    (item) => item.projectId === selectedId
  );

  const surfaces = walkthrough?.surfaces || [];

  const totalArea = surfaces.reduce(
    (sum, surface) => sum + (Number(surface.squareFeet) || 0),
    0
  );

  const coatedArea = surfaces.reduce(
    (sum, surface) =>
      sum +
      (Number(surface.squareFeet) || 0) *
        (Number(surface.coats) || 1),
    0
  );

  const preparationArea = surfaces.reduce(
    (sum, surface) =>
      sum +
      (surface.preparation && surface.preparation !== "None"
        ? Number(surface.squareFeet) || 0
        : 0),
    0
  );

  const safeCoverage = Math.max(1, Number(rates.coverage) || 1);

  const gallons = Math.ceil(
    (coatedArea / safeCoverage) *
      (1 + (Number(rates.wastePercent) || 0) / 100)
  );

  const paintCost = gallons * (Number(rates.paintPrice) || 0);

  // Labor rate is charged per square foot of surface area.
  const laborCost = totalArea * (Number(rates.laborRate) || 0);

  const preparationCost =
    preparationArea * (Number(rates.prepRate) || 0);

  const subtotal = paintCost + laborCost + preparationCost;

  const markup =
    subtotal * ((Number(rates.markupPercent) || 0) / 100);

  const total = subtotal + markup;

  function updateRate(name: keyof Rates, value: string) {
    const parsed = Number(value);

    setRates((previous) => ({
      ...previous,
      [name]: Number.isFinite(parsed) ? Math.max(0, parsed) : 0,
    }));

    setMessage("");
  }

  function saveRates() {
    try {
      localStorage.setItem(
        "mercury_estimate_rates",
        JSON.stringify(rates)
      );

      setMessage("Estimating rates saved successfully.");
    } catch {
      setMessage("Unable to save estimating rates.");
    }
  }

  function printEstimate() {
    if (!project || surfaces.length === 0) return;

    window.print();
  }

  const inputStyle =
    "w-full rounded-xl border border-gray-200 bg-[#F7F8FA] px-4 py-3 text-[#252525] outline-none focus:border-[#ED1C24]";

  return (
    <main className="min-h-screen bg-[#F5F5F5] text-[#252525]">

      {/* HEADER */}
      <header className="no-print relative z-30 border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-3">

          <Link
            href="/"
            className="flex min-w-0 items-center gap-3 sm:gap-5"
          >
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
              <Link
                key={item.href}
                href={item.href}
                className={`border-b-4 py-2 text-sm font-bold transition ${
                  item.href === "/estimates"
                    ? "border-[#FFD400] text-[#ED1C24]"
                    : "border-transparent text-gray-600 hover:text-[#ED1C24]"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <Link
            href="/projects/new"
            className="hidden rounded-xl bg-[#ED1C24] px-6 py-4 text-sm font-black text-white shadow-lg hover:bg-red-700 sm:inline-flex"
          >
            + New Project
          </Link>

          <button
            type="button"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label={menuOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={menuOpen}
            className="rounded-xl border border-gray-200 px-4 py-3 text-xl lg:hidden"
          >
            {menuOpen ? "✕" : "☰"}
          </button>
        </div>

        {menuOpen && (
          <nav className="absolute left-0 right-0 top-full border-t border-gray-200 bg-white p-5 shadow-xl lg:hidden">
            {[
              ...navigation,
              { label: "AI Walkthrough", href: "/walkthrough" },
              { label: "New Project", href: "/projects/new" },
            ].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMenuOpen(false)}
                className="block rounded-xl px-4 py-4 font-bold hover:bg-red-50 hover:text-[#ED1C24]"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        )}
      </header>

      {/* MAIN CONTENT */}
      <section className="mx-auto max-w-7xl px-5 py-12">

        <div className="no-print mb-10">
          <div className="mb-4 flex items-center gap-3">
            <span className="h-1.5 w-12 bg-[#ED1C24]" />

            <p className="text-sm font-black uppercase tracking-widest text-[#ED1C24]">
              Smart Estimating
            </p>
          </div>

          <h1 className="text-3xl font-black uppercase tracking-tight sm:text-5xl">
            Painting Estimates
          </h1>

          <p className="mt-4 max-w-2xl leading-7 text-gray-600">
            Convert walkthrough measurements into material quantities,
            labor costs, and professional painting estimates.
          </p>

          <div className="mt-6 h-2 w-28 bg-[#FFD400]" />
        </div>

        {/* PROJECT SELECTION */}
        <div className="no-print rounded-2xl border border-gray-100 bg-white p-6 shadow-md">

          <h2 className="text-xl font-black">
            📁 Select Painting Project
          </h2>

          <p className="mt-2 text-sm text-gray-500">
            Choose a project with recorded walkthrough measurements.
          </p>

          {!loaded ? (
            <p className="mt-5 text-gray-500">Loading projects...</p>
          ) : projects.length === 0 ? (
            <div className="mt-5 rounded-xl bg-yellow-50 p-5">
              <p className="font-bold">
                No projects have been created yet.
              </p>

              <Link
                href="/projects/new"
                className="mt-4 inline-flex rounded-xl bg-[#ED1C24] px-5 py-3 font-black text-white"
              >
                + Create Project
              </Link>
            </div>
          ) : (
            <select
              value={selectedId}
              onChange={(event) => {
                setSelectedId(event.target.value);
                setMessage("");
              }}
              className={`${inputStyle} mt-5`}
            >
              {projects.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.customerName} — {item.address}
                </option>
              ))}
            </select>
          )}
        </div>

        {project && (
          <>
            {/* ESTIMATE SUMMARY */}
            <div className="no-print mt-8 grid gap-5 sm:grid-cols-3">

              <div className="rounded-2xl bg-white p-6 shadow-md">
                <p className="text-sm font-bold text-gray-500">
                  Measured Area
                </p>
                <p className="mt-3 text-4xl font-black">
                  {totalArea.toLocaleString()}
                  <span className="ml-2 text-base">sq ft</span>
                </p>
                <div className="mt-4 h-1.5 w-20 bg-[#ED1C24]" />
              </div>

              <div className="rounded-2xl bg-white p-6 shadow-md">
                <p className="text-sm font-bold text-gray-500">
                  Estimated Paint
                </p>
                <p className="mt-3 text-4xl font-black">
                  {gallons}
                  <span className="ml-2 text-base">gallons</span>
                </p>
                <div className="mt-4 h-1.5 w-20 bg-[#FFD400]" />
              </div>

              <div className="rounded-2xl bg-[#252525] p-6 text-white shadow-md">
                <p className="text-sm font-bold text-gray-300">
                  Estimated Total
                </p>
                <p className="mt-3 text-4xl font-black text-[#FFD400]">
                  {money(total)}
                </p>
                <div className="mt-4 h-1.5 w-20 bg-[#ED1C24]" />
              </div>
            </div>

            {/* ESTIMATING RATES */}
            <section className="no-print mt-8 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-md">

              <div className="border-b border-gray-100 px-6 py-6">
                <h2 className="text-2xl font-black">
                  ⚙️ Estimating Rates
                </h2>
                <p className="mt-2 text-sm text-gray-500">
                  Adjust these preliminary rates to match Mercury
                  Painting&apos;s actual pricing.
                </p>
              </div>

              <div className="grid gap-5 p-6 sm:grid-cols-2 lg:grid-cols-3">

                {[
                  {
                    name: "coverage",
                    label: "Paint Coverage (sq ft / gallon)",
                  },
                  {
                    name: "paintPrice",
                    label: "Paint Price ($ / gallon)",
                  },
                  {
                    name: "laborRate",
                    label: "Labor Rate ($ / sq ft)",
                  },
                  {
                    name: "prepRate",
                    label: "Preparation Rate ($ / sq ft)",
                  },
                  {
                    name: "wastePercent",
                    label: "Paint Waste (%)",
                  },
                  {
                    name: "markupPercent",
                    label: "Markup (%)",
                  },
                ].map((field) => (
                  <div key={field.name}>
                    <label
                      htmlFor={field.name}
                      className="mb-2 block text-sm font-bold"
                    >
                      {field.label}
                    </label>

                    <input
                      id={field.name}
                      type="number"
                      min="0"
                      step="0.01"
                      value={rates[field.name as keyof Rates]}
                      onChange={(event) =>
                        updateRate(
                          field.name as keyof Rates,
                          event.target.value
                        )
                      }
                      className={inputStyle}
                    />
                  </div>
                ))}
              </div>

              <div className="border-t border-gray-100 px-6 py-5">
                <button
                  type="button"
                  onClick={saveRates}
                  className="rounded-xl bg-[#ED1C24] px-6 py-4 font-black text-white hover:bg-red-700"
                >
                  SAVE ESTIMATING RATES
                </button>

                {message && (
                  <p role="status" className="mt-3 text-sm font-bold">
                    {message}
                  </p>
                )}
              </div>
            </section>

            {/* CUSTOMER ESTIMATE */}
            <section
              id="printable-estimate"
              className="mt-8 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-md"
            >

              <div className="border-b-4 border-[#FFD400] p-6 sm:p-8">
                <div className="flex flex-wrap items-center justify-between gap-5">

                  <div className="flex items-center gap-4">
                    <div className="relative h-20 w-32">
                      <Image
                        src="/images/mercury-logo.png"
                        alt="Mercury Painting Company"
                        fill
                        sizes="128px"
                        className="object-contain object-left"
                      />
                    </div>

                    <div className="border-l-4 border-[#FFD400] pl-4">
                      <p className="text-lg font-black text-[#ED1C24]">
                        PAINTING ESTIMATE
                      </p>
                    </div>
                  </div>

                  <div className="text-sm text-gray-500">
                    <p>
                      Prepared: {new Date().toLocaleDateString("en-US")}
                    </p>
                    <p>Estimate Status: Preliminary</p>
                  </div>
                </div>
              </div>

              <div className="p-6 sm:p-8">

                <div className="grid gap-6 sm:grid-cols-2">

                  <div>
                    <p className="text-xs font-black uppercase tracking-widest text-[#ED1C24]">
                      Prepared For
                    </p>

                    <h3 className="mt-3 text-xl font-black">
                      {project.customerName}
                    </h3>

                    {project.companyName && (
                      <p className="mt-1 text-gray-600">
                        {project.companyName}
                      </p>
                    )}

                    {project.phone && (
                      <p className="mt-1 text-sm text-gray-600">
                        {project.phone}
                      </p>
                    )}

                    {project.email && (
                      <p className="mt-1 text-sm text-gray-600">
                        {project.email}
                      </p>
                    )}
                  </div>

                  <div>
                    <p className="text-xs font-black uppercase tracking-widest text-[#ED1C24]">
                      Project Location
                    </p>

                    <p className="mt-3 font-bold">
                      {project.address}
                    </p>

                    <p className="mt-2 text-sm text-gray-500">
                      {project.projectType} • {project.paintingType}
                    </p>
                  </div>
                </div>

                <div className="mt-10">
                  <h3 className="text-xl font-black uppercase">
                    Scope of Work
                  </h3>

                  <div className="mt-5 overflow-x-auto">
                    <table className="w-full min-w-[500px] text-left text-sm">

                      <thead className="bg-[#252525] text-white">
                        <tr>
                          <th className="p-4">Surface</th>
                          <th className="p-4">Area</th>
                          <th className="p-4">Coats</th>
                          <th className="p-4">Preparation</th>
                        </tr>
                      </thead>

                      <tbody>
                        {surfaces.map((surface) => (
                          <tr
                            key={surface.id}
                            className="border-b border-gray-100"
                          >
                            <td className="p-4 font-bold">
                              {surface.name}
                            </td>

                            <td className="p-4">
                              {surface.squareFeet.toLocaleString()} sq ft
                            </td>

                            <td className="p-4">
                              {surface.coats}
                            </td>

                            <td className="p-4">
                              {surface.preparation || "None"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {surfaces.length === 0 && (
                    <div className="no-print mt-5 rounded-xl bg-yellow-50 p-5">
                      <p className="font-bold">
                        No walkthrough measurements found.
                      </p>

                      <p className="mt-2 text-sm text-gray-600">
                        Record painting surfaces before generating
                        an estimate.
                      </p>

                      <Link
                        href="/walkthrough"
                        className="mt-4 inline-flex rounded-xl bg-[#ED1C24] px-5 py-3 font-black text-white"
                      >
                        START WALKTHROUGH →
                      </Link>
                    </div>
                  )}
                </div>

                {/* COST BREAKDOWN */}
                {surfaces.length > 0 && (
                  <div className="mt-10">

                    <h3 className="text-xl font-black uppercase">
                      Estimated Project Costs
                    </h3>

                    <div className="mt-5 space-y-4">

                      {[
                        {
                          label: `Paint Materials (${gallons} gallons)`,
                          value: paintCost,
                        },
                        {
                          label: "Painting Labor",
                          value: laborCost,
                        },
                        {
                          label: "Surface Preparation",
                          value: preparationCost,
                        },
                        {
                          label: "Subtotal",
                          value: subtotal,
                        },
                        {
                          label: `Markup (${rates.markupPercent}%)`,
                          value: markup,
                        },
                      ].map((item) => (
                        <div
                          key={item.label}
                          className="flex justify-between gap-4 border-b border-gray-100 pb-3"
                        >
                          <span className="text-gray-600">
                            {item.label}
                          </span>

                          <span className="font-black">
                            {money(item.value)}
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className="mt-7 flex flex-wrap items-center justify-between gap-4 rounded-xl bg-[#252525] p-6 text-white">
                      <p className="text-xl font-black">
                        TOTAL ESTIMATED PRICE
                      </p>

                      <p className="text-3xl font-black text-[#FFD400]">
                        {money(total)}
                      </p>
                    </div>

                    <p className="mt-5 text-xs leading-6 text-gray-500">
                      Preliminary estimate based on recorded measurements
                      and adjustable pricing assumptions. Final pricing
                      requires review of site conditions, scope, materials,
                      access, and applicable taxes or fees.
                    </p>
                  </div>
                )}
              </div>
            </section>

            {/* PRINT BUTTON */}
            {surfaces.length > 0 && (
              <div className="no-print mt-8 flex flex-wrap gap-4">

                <button
                  type="button"
                  onClick={printEstimate}
                  className="rounded-xl bg-[#ED1C24] px-8 py-5 font-black text-white shadow-lg hover:bg-red-700"
                >
                  🖨️ PRINT / SAVE AS PDF
                </button>

                <Link
                  href="/walkthrough"
                  className="rounded-xl border-2 border-[#252525] bg-white px-8 py-5 font-black"
                >
                  ← EDIT WALKTHROUGH
                </Link>
              </div>
            )}
          </>
        )}
      </section>

      {/* FOOTER — MATCHES OTHER PAGES */}
      <footer className="no-print mt-12 border-t-4 border-[#FFD400] bg-white px-5 py-8">

        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-5">

          <div className="flex items-center gap-3">

            <div className="relative h-16 w-24">
              <Image
                src="/images/mercury-logo.png"
                alt="Mercury Painting Company"
                fill
                sizes="96px"
                className="object-contain"
              />
            </div>

            <div className="border-l-2 border-[#FFD400] pl-3">
              <p className="font-black text-[#ED1C24]">
                AI ESTIMATOR
              </p>
            </div>
          </div>

          <p className="text-xs text-gray-400">
            Developed by ECI — Emerald Coast Innovations
          </p>
        </div>
      </footer>

      {/* PRINT STYLES */}
      <style jsx global>{`
        @media print {
          @page {
            margin: 12mm;
          }

          body {
            background: white !important;
          }

          .no-print {
            display: none !important;
          }

          main {
            background: white !important;
            min-height: 0 !important;
          }

          main > section {
            padding: 0 !important;
            max-width: none !important;
          }

          #printable-estimate {
            margin: 0 !important;
            border: none !important;
            box-shadow: none !important;
          }

          #printable-estimate table {
            width: 100%;
          }

          #printable-estimate tr {
            break-inside: avoid;
          }

          #printable-estimate h3 {
            break-after: avoid;
          }

          #printable-estimate {
            print-color-adjust: exact;
            -webkit-print-color-adjust: exact;
          }
        }
      `}</style>
    </main>
  );
}