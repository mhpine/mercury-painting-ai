"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";

const navigation = [
  { label: "Dashboard", href: "/" },
  { label: "Projects", href: "/projects" },
  { label: "Estimates", href: "/estimates" },
  { label: "Settings", href: "/settings" },
];

export default function NewProjectPage() {
  const router = useRouter();

  const [saving, setSaving] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) setLoggedIn(Boolean(data.session));
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) setLoggedIn(Boolean(session));
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  async function handleLogout() {
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

  const [form, setForm] = useState({
    customerName: "",
    companyName: "",
    phone: "",
    email: "",
    address: "",
    projectType: "Commercial",
    paintingType: "Interior",
    description: "",
    startDate: "",
  });

  function updateField(
    event: React.ChangeEvent<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >
  ) {
    const { name, value } = event.target;

    setForm((previous) => ({
      ...previous,
      [name]: value,
    }));
  }

  
async function createProject(
  event: React.FormEvent<HTMLFormElement>
) {
  event.preventDefault();

  if (saving) return;

  if (!form.customerName.trim() || !form.address.trim()) {
    alert("Please enter the customer name and project address.");
    return;
  }

  setSaving(true);

  try {
    const { data: userData, error: authError } =
      await supabase.auth.getUser();

    if (authError || !userData.user) {
      alert("Your session has expired. Please log in again.");
      router.replace("/login");
      return;
    }

    const project = {
      ...form,
      id: crypto.randomUUID(),
      status: "Draft",
      createdAt: new Date().toISOString(),
    };

    const { error: insertError } = await supabase
      .from("mercury_projects")
      .insert({
        id: project.id,
        owner_id: userData.user.id,
        name: `${form.customerName.trim()} - ${form.address.trim()}`,
        customer_name: form.customerName.trim(),
        address: form.address.trim(),
        status: project.status,
        project_data: project,
      });

    if (insertError) {
      throw insertError;
    }

    // Keep a local copy for existing pages.
    // Supabase remains the primary saved record.
    try {
      const saved = JSON.parse(
        localStorage.getItem("mercury_projects") || "[]"
      );

      const projects = Array.isArray(saved) ? saved : [];

      localStorage.setItem(
        "mercury_projects",
        JSON.stringify([
          project,
          ...projects.filter(
            (item) => item?.id !== project.id
          ),
        ])
      );
    } catch (cacheError) {
      console.warn(
        "Project saved online, but local cache update failed:",
        cacheError
      );
    }

    alert("Project saved to Supabase successfully!");
    router.push("/projects");
  } catch (error) {
    console.error("Unable to save project:", error);

    alert(
      error instanceof Error
        ? `Unable to save project: ${error.message}`
        : "Unable to save project. Please try again."
    );
  } finally {
    setSaving(false);
  }
}

  const inputStyle =
    "w-full rounded-xl border border-gray-200 bg-[#F7F8FA] px-4 py-4 text-[#252525] outline-none transition focus:border-[#ED1C24] focus:ring-2 focus:ring-red-100";

  const labelStyle =
    "mb-2 block text-sm font-bold text-[#252525]";

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

            {/* AI ESTIMATOR */}
            <div className="border-l-4 border-[#FFD400] pl-3 sm:pl-5">
              <span className="text-base font-black uppercase tracking-wide text-[#ED1C24] sm:text-2xl">
                AI ESTIMATOR
              </span>
            </div>
          </Link>

          {/* DESKTOP NAVIGATION */}
          <nav className="hidden items-center gap-8 lg:flex">
            {navigation.map((item) => {
              const active = item.href === "/projects";

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`border-b-4 py-2 text-sm font-bold transition ${
                    active
                      ? "border-[#FFD400] text-[#ED1C24]"
                      : "border-transparent text-gray-600 hover:text-[#ED1C24]"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {/* NEW PROJECT BUTTON */}
          <Link
            href="/projects/new"
            className="hidden rounded-xl bg-[#ED1C24] px-6 py-4 text-sm font-black text-white shadow-lg transition hover:bg-red-700 sm:inline-flex"
          >
            + New Project
          </Link>

          {/* DESKTOP AUTHENTICATION — RIGHT SIDE ONLY */}
          {loggedIn !== null && (
            loggedIn ? (
              <button
                type="button"
                onClick={handleLogout}
                disabled={signingOut}
                className="hidden rounded-xl border border-[#ED1C24] px-5 py-3 text-sm font-black text-[#ED1C24] transition hover:bg-red-50 disabled:opacity-50 lg:inline-flex"
              >
                {signingOut ? "Signing Out..." : "Log Out"}
              </button>
            ) : (
              <Link
                href="/login"
                className="hidden rounded-xl border border-[#ED1C24] px-5 py-3 text-sm font-black text-[#ED1C24] transition hover:bg-red-50 lg:inline-flex"
              >
                Log In
              </Link>
            )
          )}

          {/* MOBILE MENU BUTTON */}
          <button
            type="button"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label={
              menuOpen ? "Close navigation" : "Open navigation"
            }
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
                className="block rounded-xl px-4 py-4 font-bold transition hover:bg-red-50 hover:text-[#ED1C24]"
              >
                {item.label}
              </Link>
            ))}
            {loggedIn !== null && (
              loggedIn ? (
                <button
                  type="button"
                  onClick={handleLogout}
                  disabled={signingOut}
                  className="mt-2 block w-full rounded-xl bg-[#ED1C24] px-4 py-4 text-left font-bold text-white disabled:opacity-50"
                >
                  {signingOut ? "Signing Out..." : "Log Out"}
                </button>
              ) : (
                <Link
                  href="/login"
                  onClick={() => setMenuOpen(false)}
                  className="mt-2 block rounded-xl bg-[#ED1C24] px-4 py-4 font-bold text-white"
                >
                  Log In
                </Link>
              )
            )}
          </nav>
        )}
      </header>

      {/* PAGE CONTENT */}
      <section className="mx-auto max-w-4xl px-5 py-12">

        {/* PAGE TITLE */}
        <div className="mb-10">

          <div className="mb-4 flex items-center gap-3">
            <span className="h-1.5 w-12 bg-[#ED1C24]" />

            <p className="text-sm font-black uppercase tracking-widest text-[#ED1C24]">
              Project Management
            </p>
          </div>

          <h1 className="text-3xl font-black uppercase tracking-tight sm:text-5xl">
            New Painting Project
          </h1>

          <p className="mt-4 max-w-2xl leading-7 text-gray-600">
            Enter customer and project information to begin
            preparing a professional painting estimate.
          </p>

          <div className="mt-6 h-2 w-28 bg-[#FFD400]" />

          <Link
            href="/projects"
            className="mt-6 inline-flex items-center gap-2 text-sm font-black text-[#ED1C24] transition hover:text-red-700"
          >
            ← BACK TO PROJECTS
          </Link>
        </div>

        {/* NEW PROJECT FORM */}
        <form onSubmit={createProject} className="space-y-7">

          {/* CUSTOMER INFORMATION */}
          <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-md">

            <div className="border-b border-gray-100 px-6 py-6">

              <div className="flex items-center gap-4">

                <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-red-50 text-3xl">
                  👤
                </div>

                <div>
                  <h2 className="text-xl font-black sm:text-2xl">
                    Customer Information
                  </h2>

                  <p className="mt-1 text-sm text-gray-500">
                    Who are we preparing this estimate for?
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-6 p-6 sm:grid-cols-2">

              {/* CUSTOMER NAME */}
              <div>
                <label htmlFor="customerName" className={labelStyle}>
                  Customer Name *
                </label>

                <input
                  id="customerName"
                  name="customerName"
                  required
                  value={form.customerName}
                  onChange={updateField}
                  placeholder="John Smith"
                  className={inputStyle}
                />
              </div>

              {/* COMPANY NAME */}
              <div>
                <label htmlFor="companyName" className={labelStyle}>
                  Company Name
                </label>

                <input
                  id="companyName"
                  name="companyName"
                  value={form.companyName}
                  onChange={updateField}
                  placeholder="ABC Properties"
                  className={inputStyle}
                />
              </div>

              {/* PHONE */}
              <div>
                <label htmlFor="phone" className={labelStyle}>
                  Phone Number
                </label>

                <input
                  id="phone"
                  name="phone"
                  type="tel"
                  value={form.phone}
                  onChange={updateField}
                  placeholder="(555) 555-5555"
                  className={inputStyle}
                />
              </div>

              {/* EMAIL */}
              <div>
                <label htmlFor="email" className={labelStyle}>
                  Email Address
                </label>

                <input
                  id="email"
                  name="email"
                  type="email"
                  value={form.email}
                  onChange={updateField}
                  placeholder="customer@example.com"
                  className={inputStyle}
                />
              </div>
            </div>
          </section>

          {/* PROJECT DETAILS */}
          <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-md">

            <div className="border-b border-gray-100 px-6 py-6">

              <div className="flex items-center gap-4">

                <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-yellow-100 text-3xl">
                  🏢
                </div>

                <div>
                  <h2 className="text-xl font-black sm:text-2xl">
                    Project Details
                  </h2>

                  <p className="mt-1 text-sm text-gray-500">
                    Tell us about the painting project.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-6 p-6">

              {/* PROJECT ADDRESS */}
              <div>
                <label htmlFor="address" className={labelStyle}>
                  Project Address *
                </label>

                <input
                  id="address"
                  name="address"
                  required
                  value={form.address}
                  onChange={updateField}
                  placeholder="Street, City, State, ZIP"
                  className={inputStyle}
                />
              </div>

              {/* PROJECT TYPE + PAINTING TYPE */}
              <div className="grid gap-6 sm:grid-cols-2">

                <div>
                  <label htmlFor="projectType" className={labelStyle}>
                    Project Type
                  </label>

                  <select
                    id="projectType"
                    name="projectType"
                    value={form.projectType}
                    onChange={updateField}
                    className={inputStyle}
                  >
                    <option>Commercial</option>
                    <option>Residential</option>
                    <option>Industrial</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="paintingType" className={labelStyle}>
                    Painting Type
                  </label>

                  <select
                    id="paintingType"
                    name="paintingType"
                    value={form.paintingType}
                    onChange={updateField}
                    className={inputStyle}
                  >
                    <option>Interior</option>
                    <option>Exterior</option>
                    <option>Interior &amp; Exterior</option>
                  </select>
                </div>
              </div>

              {/* ESTIMATED START DATE */}
              <div>
                <label htmlFor="startDate" className={labelStyle}>
                  Estimated Start Date
                </label>

                <input
                  id="startDate"
                  name="startDate"
                  type="date"
                  value={form.startDate}
                  onChange={updateField}
                  className={inputStyle}
                />
              </div>

              {/* PROJECT DESCRIPTION */}
              <div>
                <label htmlFor="description" className={labelStyle}>
                  Project Description
                </label>

                <textarea
                  id="description"
                  name="description"
                  value={form.description}
                  onChange={updateField}
                  placeholder="Describe the painting work, surface conditions, and any special requirements..."
                  className={`${inputStyle} min-h-36 resize-y`}
                />
              </div>
            </div>
          </section>

          {/* AI WALKTHROUGH INFORMATION */}
          <div className="rounded-2xl border border-yellow-200 bg-yellow-50 p-6">

            <div className="flex items-start gap-4">

              <span className="text-3xl">📷</span>

              <div>
                <h3 className="text-lg font-black">
                  Next: AI Walkthrough
                </h3>

                <p className="mt-2 text-sm leading-7 text-gray-600">
                  After creating the project, you will be able to
                  document surfaces, record measurements, calculate
                  materials, and prepare your painting estimate.
                </p>
              </div>
            </div>
          </div>

          {/* SAVE PROJECT BUTTON */}
          <button
            type="submit"
            disabled={saving}
            className="flex w-full items-center justify-center gap-3 rounded-xl bg-[#ED1C24] px-6 py-5 text-lg font-black text-white shadow-lg shadow-red-100 transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Saving Project..." : "CREATE PROJECT →"}
          </button>

          {/* PROTOTYPE NOTICE */}
          <p className="text-center text-xs leading-6 text-gray-400">
            Prototype mode — projects are saved in this browser only.
            <br />
            Use fictional customer information during testing.
          </p>
        </form>
      </section>

      {/* FOOTER */}
      <footer className="mt-12 border-t-4 border-[#FFD400] bg-white px-5 py-8">

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