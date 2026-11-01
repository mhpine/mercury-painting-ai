"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";

const navigation = [
  { label: "Dashboard", href: "/" },
  { label: "Projects", href: "/projects" },
  { label: "Estimates", href: "/estimates" },
  { label: "Settings", href: "/settings" },
];

const ACTIVE_ROUTE = "/projects";

type Project = {
  id: string;
  customerName: string;
  companyName?: string;
  phone?: string;
  email?: string;
  address: string;
  projectType: string;
  paintingType: string;
  description?: string;
  status: string;
  createdAt: string;
};

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [search, setSearch] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("mercury_projects");
      const parsed = saved ? JSON.parse(saved) : [];

      setProjects(Array.isArray(parsed) ? parsed : []);
    } catch (error) {
      console.error("Unable to load projects:", error);
      setProjects([]);
    } finally {
      setLoaded(true);
    }
  }, []);

  const filteredProjects = projects.filter((project) => {
    const query = search.toLowerCase();

    return (
      (project.customerName || "").toLowerCase().includes(query) ||
      (project.companyName || "").toLowerCase().includes(query) ||
      (project.address || "").toLowerCase().includes(query)
    );
  });

  const draftCount = projects.filter(
    (project) => project.status === "Draft"
  ).length;

  const activeCount = projects.filter(
    (project) =>
      project.status === "Active" ||
      project.status === "In Progress"
  ).length;

  function formatDate(date: string) {
    if (!date) return "Unknown";

    const parsed = new Date(date);

    if (Number.isNaN(parsed.getTime())) return "Unknown";

    return parsed.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  return (
    <main className="min-h-screen bg-[#F7F8FA] text-[#292D32]">

      {/* HEADER */}
      <header className="relative z-30 border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-3">
          <Link href="/" className="flex min-w-0 items-center gap-3 sm:gap-5">
            <div className="relative h-20 w-36 shrink-0 sm:h-24 sm:w-52">
              <Image src="/images/mercury-logo.png" alt="Mercury Painting Company" fill priority sizes="(max-width: 640px) 144px, 208px" className="object-contain object-left" />
            </div>
            <div className="border-l-4 border-[#FFD400] pl-3 sm:pl-5">
              <span className="text-base font-black uppercase tracking-wide text-[#ED1C24] sm:text-2xl">AI ESTIMATOR</span>
            </div>
          </Link>
          <nav className="hidden items-center gap-8 lg:flex">
            {navigation.map((item) => (
              <Link key={item.href} href={item.href} className={`border-b-4 py-2 text-sm font-bold transition ${item.href === ACTIVE_ROUTE ? "border-[#FFD400] text-[#ED1C24]" : "border-transparent text-gray-600 hover:text-[#ED1C24]"}`}>
                {item.label}
              </Link>
            ))}
          </nav>
          <Link href="/projects/new" className="hidden rounded-xl bg-[#ED1C24] px-6 py-4 text-sm font-black text-white shadow-lg transition hover:bg-red-700 sm:inline-flex">+ New Project</Link>
          <button type="button" onClick={() => setMenuOpen(!menuOpen)} aria-label={menuOpen ? "Close navigation" : "Open navigation"} aria-expanded={menuOpen} className="rounded-xl border border-gray-200 px-4 py-3 text-xl lg:hidden">{menuOpen ? "✕" : "☰"}</button>
        </div>
        {menuOpen && (
          <nav className="absolute left-0 right-0 top-full border-t border-gray-200 bg-white p-5 shadow-xl lg:hidden">
            {[...navigation, {label:"AI Walkthrough",href:"/walkthrough"}, {label:"New Project",href:"/projects/new"}].map(item => (
              <Link key={item.href} href={item.href} onClick={() => setMenuOpen(false)} className="block rounded-xl px-4 py-4 font-bold hover:bg-red-50 hover:text-[#ED1C24]">{item.label}</Link>
            ))}
          </nav>
        )}
      </header>

      {/* PAGE CONTENT */}
      <section className="mx-auto max-w-6xl px-5 py-10">

        <div className="flex flex-wrap items-center justify-between gap-5">
          <div>
            <p className="mb-2 text-sm font-bold uppercase tracking-widest text-[#F71920]">
              Project Management
            </p>

            <h2 className="text-3xl font-black sm:text-4xl">
              Painting Projects
            </h2>

            <p className="mt-3 text-gray-500">
              Manage customers, painting projects, and estimates.
            </p>
          </div>

          <Link
            href="/projects/new"
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#F71920] px-6 py-4 font-black text-white shadow-md transition hover:bg-red-700"
          >
            + New Project
          </Link>
        </div>

        {/* PROJECT STATISTICS */}
        <div className="mt-8 grid gap-4 sm:grid-cols-3">

          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <p className="text-sm font-semibold text-gray-500">
              Total Projects
            </p>

            <p className="mt-3 text-4xl font-black">
              {projects.length}
            </p>

            <div className="mt-4 h-1.5 w-12 rounded-full bg-[#F71920]" />
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <p className="text-sm font-semibold text-gray-500">
              Active Projects
            </p>

            <p className="mt-3 text-4xl font-black">
              {activeCount}
            </p>

            <div className="mt-4 h-1.5 w-12 rounded-full bg-[#FFD400]" />
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <p className="text-sm font-semibold text-gray-500">
              Draft Projects
            </p>

            <p className="mt-3 text-4xl font-black">
              {draftCount}
            </p>

            <div className="mt-4 h-1.5 w-12 rounded-full bg-[#292D32]" />
          </div>
        </div>

        {/* SEARCH */}
        <div className="mt-8 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <label
            htmlFor="project-search"
            className="mb-3 block text-sm font-bold"
          >
            Search Projects
          </label>

          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xl">
              🔎
            </span>

            <input
              id="project-search"
              type="search"
              placeholder="Search customer, company, or address..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full rounded-xl border border-gray-200 bg-[#F7F8FA] py-4 pl-12 pr-4 text-[#292D32] outline-none transition focus:border-[#F71920]"
            />
          </div>
        </div>

        {/* PROJECT LIST */}
        <div className="mt-8 space-y-4">

          {!loaded ? (
            <div className="rounded-2xl bg-white p-10 text-center text-gray-500">
              Loading projects...
            </div>
          ) : filteredProjects.length === 0 ? (
            <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center shadow-sm">

              <div className="mb-4 text-5xl">📁</div>

              <h3 className="text-2xl font-black">
                {projects.length === 0
                  ? "No Projects Yet"
                  : "No Matching Projects"}
              </h3>

              <p className="mx-auto mt-3 max-w-md text-gray-500">
                {projects.length === 0
                  ? "Create your first painting project to begin building professional estimates."
                  : "Try searching for a different customer, company, or address."}
              </p>

              {projects.length === 0 && (
                <Link
                  href="/projects/new"
                  className="mt-6 inline-block rounded-xl bg-[#F71920] px-6 py-4 font-bold text-white transition hover:bg-red-700"
                >
                  Create First Project
                </Link>
              )}
            </div>
          ) : (
            filteredProjects.map((project) => (
              <div
                key={project.id}
                className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm transition hover:border-red-200 hover:shadow-md"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">

                  <div>
                    <div className="mb-3 flex items-center gap-3">
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-50 text-2xl">
                        🎨
                      </div>

                      <div>
                        <h3 className="text-xl font-black">
                          {project.customerName}
                        </h3>

                        {project.companyName && (
                          <p className="text-sm text-gray-500">
                            {project.companyName}
                          </p>
                        )}
                      </div>
                    </div>

                    <p className="mt-3 text-sm text-gray-600">
                      📍 {project.address}
                    </p>

                    <p className="mt-2 text-sm text-gray-600">
                      🏢 {project.projectType} • {project.paintingType}
                    </p>

                    {project.phone && (
                      <p className="mt-2 text-sm text-gray-600">
                        📞 {project.phone}
                      </p>
                    )}

                    {project.email && (
                      <p className="mt-2 text-sm text-gray-600">
                        ✉️ {project.email}
                      </p>
                    )}
                  </div>

                  <span className="rounded-full border border-yellow-300 bg-yellow-50 px-4 py-2 text-sm font-bold text-[#292D32]">
                    {project.status || "Draft"}
                  </span>
                </div>

                {project.description && (
                  <p className="mt-4 rounded-xl bg-gray-50 p-4 text-sm leading-6 text-gray-600">
                    {project.description}
                  </p>
                )}

                <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-gray-100 pt-5">
                  <p className="text-xs text-gray-400">
                    Created: {formatDate(project.createdAt)}
                  </p>

                  <Link
  href="/walkthrough"
  className="inline-flex items-center gap-2 rounded-xl bg-[#ED1C24] px-5 py-3 text-sm font-black text-white shadow-md transition hover:bg-red-700"
>
  📷 START AI WALKTHROUGH →
</Link>
                </div>
              </div>
            ))
          )}
        </div>


      </section>
      {/* FOOTER */}
      <footer className="mt-12 border-t-4 border-[#FFD400] bg-white px-5 py-8">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-5">
          <div className="flex items-center gap-3">
            <div className="relative h-16 w-24">
              <Image src="/images/mercury-logo.png" alt="Mercury Painting Company" fill sizes="96px" className="object-contain" />
            </div>
            <div className="border-l-2 border-[#FFD400] pl-3">
              <p className="font-black text-[#ED1C24]">AI ESTIMATOR</p>
            </div>
          </div>
          <p className="text-xs text-gray-400">Developed by ECI — Emerald Coast Innovations</p>
        </div>
      </footer>
    </main>
  );
}