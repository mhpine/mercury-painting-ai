"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";

type Project = {
  id: string;
  status?: string;
  createdAt?: string;
};

const navigation = [
  { label: "Dashboard", href: "/" },
  { label: "Projects", href: "/projects" },
  { label: "Estimates", href: "/estimates" },
  { label: "Settings", href: "/settings" },
];

const actions = [
  {
    number: "01",
    icon: "📷",
    title: "AI Walkthrough",
    description:
      "Document painting surfaces, capture site conditions, and prepare professional estimates.",
    href: "/walkthrough",
    button: "Start Walkthrough",
    featured: true,
  },
  {
    number: "02",
    icon: "➕",
    title: "New Project",
    description:
      "Create a customer project and organize everything needed for an estimate.",
    href: "/projects/new",
    button: "Create Project",
    featured: false,
  },
  {
    number: "03",
    icon: "📁",
    title: "Project Manager",
    description:
      "Manage customer information, painting jobs, and project details.",
    href: "/projects",
    button: "View Projects",
    featured: false,
  },
  {
    number: "04",
    icon: "📄",
    title: "Estimates",
    description:
      "Review painting proposals, materials, and saved estimates.",
    href: "/estimates",
    button: "View Estimates",
    featured: false,
  },
  {
    number: "05",
    icon: "⚙️",
    title: "Estimator Settings",
    description:
      "Configure labor rates, material costs, and estimating preferences.",
    href: "/settings",
    button: "Open Settings",
    featured: false,
  },
];

export default function Home() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("mercury_projects");
      const parsed = saved ? JSON.parse(saved) : [];

      setProjects(Array.isArray(parsed) ? parsed : []);
    } catch {
      setProjects([]);
    }
  }, []);

  const totalProjects = projects.length;

  const activeProjects = projects.filter(
    (project) =>
      project.status === "Active" ||
      project.status === "In Progress"
  ).length;

  const draftProjects = projects.filter(
    (project) => project.status === "Draft"
  ).length;

  const stats = [
    {
      title: "Total Projects",
      value: totalProjects,
      icon: "📁",
      color: "bg-[#ED1C24]",
      line: "bg-[#ED1C24]",
    },
    {
      title: "Active Projects",
      value: activeProjects,
      icon: "⚡",
      color: "bg-[#FFD400]",
      line: "bg-[#FFD400]",
    },
    {
      title: "Draft Projects",
      value: draftProjects,
      icon: "📄",
      color: "bg-gray-200",
      line: "bg-[#252525]",
    },
  ];

  return (
    <main className="min-h-screen bg-[#F5F5F5] text-[#252525]">

      {/* HEADER */}
      <header className="relative z-30 border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-3">

          {/* MERCURY LOGO + AI ESTIMATOR */}
          <Link
            href="/"
            className="flex min-w-0 items-center gap-3 sm:gap-5"
          >
            {/* ORIGINAL MERCURY LOGO */}
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

            {/* AI ESTIMATOR ONLY */}
            <div className="border-l-4 border-[#FFD400] pl-3 sm:pl-5">
              <h1 className="text-base font-black uppercase tracking-wide text-[#ED1C24] sm:text-2xl">
                AI ESTIMATOR
              </h1>
            </div>
          </Link>

          {/* DESKTOP NAVIGATION */}
          <nav className="hidden items-center gap-8 lg:flex">
            {navigation.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`border-b-4 py-2 text-sm font-bold transition ${
                  item.href === "/"
                    ? "border-[#FFD400] text-[#ED1C24]"
                    : "border-transparent text-gray-600 hover:text-[#ED1C24]"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          {/* NEW PROJECT BUTTON */}
          <Link
            href="/projects/new"
            className="hidden rounded-xl bg-[#ED1C24] px-6 py-4 text-sm font-black text-white shadow-lg transition hover:bg-red-700 sm:inline-flex"
          >
            + New Project
          </Link>

          {/* MOBILE MENU BUTTON */}
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

        {/* MOBILE NAVIGATION */}
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

      {/* FULL-WIDTH HERO */}
      <section className="relative isolate min-h-[700px] overflow-hidden bg-[#171717]">

        {/* FULL-WIDTH HOUSE PHOTOGRAPH */}
        <Image
          src="/images/painting5.png"
          alt="Mercury Painting residential painting project"
          fill
          priority
          sizes="100vw"
          className="object-cover object-center"
        />

        {/* DARK GRADIENT FOR READABILITY */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/90 via-black/55 to-black/10" />

        {/* RED LEFT ACCENT */}
        <div className="absolute inset-y-0 left-0 w-2 bg-[#ED1C24]" />

        {/* HERO CONTENT */}
        <div className="relative mx-auto flex min-h-[700px] max-w-7xl items-center px-6 py-20">
          <div className="max-w-3xl">

            <div className="mb-7 flex items-center gap-4">
              <span className="h-1 w-12 bg-[#FFD400]" />

              <p className="text-xs font-black uppercase tracking-[0.2em] text-white sm:text-sm">
                Mercury Painting Company
              </p>
            </div>

            <h2 className="text-4xl font-black uppercase leading-[1.06] tracking-tight text-white sm:text-6xl lg:text-7xl">
              Precision
              <br />
              Estimating.
              <br />

              <span className="text-[#FFD400]">
                Powered by AI.
              </span>
            </h2>

            <div className="mt-8 h-1.5 w-28 bg-[#ED1C24]" />

            <p className="mt-7 max-w-xl text-lg leading-8 text-gray-100">
              A smarter way to organize painting projects,
              document job sites, and build professional estimates.
            </p>

            <div className="mt-9 flex flex-wrap gap-4">

              <Link
                href="/walkthrough"
                className="inline-flex min-h-16 items-center justify-center gap-3 rounded-xl bg-[#ED1C24] px-7 py-4 text-sm font-black text-white shadow-xl transition hover:bg-red-700 sm:text-base"
              >
                📷 START AI WALKTHROUGH →
              </Link>

              <Link
                href="/projects/new"
                className="inline-flex min-h-16 items-center justify-center rounded-xl border-2 border-white bg-black/30 px-7 py-4 font-black text-white transition hover:bg-white hover:text-black"
              >
                + NEW PROJECT
              </Link>
            </div>

            <p className="mt-8 text-xs font-bold uppercase tracking-widest text-gray-300">
              Built for Mercury Painting Company
            </p>
          </div>
        </div>

        {/* YELLOW BOTTOM ACCENT */}
        <div className="absolute bottom-0 left-0 right-0 h-2 bg-[#FFD400]" />
      </section>

      {/* PROJECT STATISTICS */}
      <section className="relative z-10 mx-auto -mt-10 max-w-7xl px-5">
        <div className="grid gap-5 sm:grid-cols-3">

          {stats.map((stat) => (
            <div
              key={stat.title}
              className="rounded-2xl border border-gray-100 bg-white p-6 shadow-xl"
            >
              <div className="flex items-center gap-4">

                <div
                  className={`flex h-16 w-16 items-center justify-center rounded-xl text-3xl ${stat.color}`}
                >
                  {stat.icon}
                </div>

                <div>
                  <p className="text-xs font-black uppercase tracking-wider text-gray-500">
                    {stat.title}
                  </p>

                  <p className="mt-1 text-4xl font-black">
                    {stat.value}
                  </p>
                </div>
              </div>

              <div
                className={`ml-20 mt-4 h-1.5 w-20 rounded-full ${stat.line}`}
              />
            </div>
          ))}
        </div>
      </section>

      {/* ESTIMATING COMMAND CENTER */}
      <section className="mx-auto max-w-7xl px-5 py-16">

        <div className="mb-10">

          <div className="mb-4 flex items-center gap-3">
            <span className="h-1.5 w-12 bg-[#ED1C24]" />

            <p className="text-sm font-black uppercase tracking-widest text-[#ED1C24]">
              Your Workspace
            </p>
          </div>

          <h2 className="text-3xl font-black uppercase tracking-tight sm:text-5xl">
            Estimating Command Center
          </h2>

          <p className="mt-4 max-w-2xl text-gray-600">
            Everything you need to manage painting projects
            and prepare professional estimates.
          </p>
        </div>

        {/* FEATURE CARDS */}
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">

          {actions.map((action) => (
            <Link
              key={action.number}
              href={action.href}
              className={`group relative flex flex-col overflow-hidden rounded-2xl border p-7 shadow-md transition duration-300 hover:-translate-y-1 hover:shadow-xl ${
                action.featured
                  ? "border-[#ED1C24] bg-[#ED1C24] text-white"
                  : "border-gray-100 bg-white text-[#252525]"
              }`}
            >
              <div className="flex items-start justify-between">
                <span className="text-4xl">
                  {action.icon}
                </span>

                <span
                  className={`text-4xl font-black ${
                    action.featured
                      ? "text-white/30"
                      : "text-gray-200"
                  }`}
                >
                  {action.number}
                </span>
              </div>

              <h3 className="mt-8 text-2xl font-black">
                {action.title}
              </h3>

              <p
                className={`mt-4 flex-1 leading-7 ${
                  action.featured
                    ? "text-white/90"
                    : "text-gray-500"
                }`}
              >
                {action.description}
              </p>

              <div
                className={`mt-7 flex items-center justify-between border-t pt-5 font-black ${
                  action.featured
                    ? "border-white/30"
                    : "border-gray-100"
                }`}
              >
                <span>{action.button}</span>

                <span className="text-2xl transition group-hover:translate-x-2">
                  →
                </span>
              </div>

              <div
                className={`absolute bottom-0 left-0 h-1.5 w-full ${
                  action.featured
                    ? "bg-[#FFD400]"
                    : "bg-[#ED1C24]"
                }`}
              />
            </Link>
          ))}
        </div>
      </section>

      {/* BRAND SECTION */}
      <section className="relative overflow-hidden bg-[#252525] px-5 py-16 text-white">

        <div className="pointer-events-none absolute -right-20 -top-20 h-80 w-80 rounded-full bg-[#ED1C24]/15 blur-3xl" />

        <div className="relative mx-auto max-w-7xl">

          <p className="text-sm font-black uppercase tracking-widest text-[#FFD400]">
            Mercury Painting Company
          </p>

          <h2 className="mt-5 text-3xl font-black uppercase leading-tight sm:text-5xl">
            Better Information.
            <br />

            <span className="text-[#FFD400]">
              Smarter Estimates.
            </span>
          </h2>

          <p className="mt-6 max-w-xl leading-8 text-gray-300">
            Bringing modern technology into the painting
            estimating process, one project at a time.
          </p>

          <Link
            href="/projects/new"
            className="mt-8 inline-flex rounded-xl bg-[#ED1C24] px-7 py-4 font-black text-white transition hover:bg-red-700"
          >
            CREATE A NEW PROJECT →
          </Link>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t-4 border-[#FFD400] bg-white px-5 py-8">

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

            <div>
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
    </main>
  );
}