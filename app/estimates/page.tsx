"use client";



import { useEffect, useState } from "react";

import Image from "next/image";

import Link from "next/link";

import { useRouter } from "next/navigation";

import { supabase } from "../lib/supabase";



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

  notes?: string;

  photoPath?: string;

};



type ProjectPhoto = { path: string; url: string };



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

  paintPrice: 55,

  laborRate: 2.0,

  prepRate: 0.50,

  wastePercent: 10,

  markupPercent: 20,

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

  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);

  const [signingOut, setSigningOut] = useState(false);

  const router = useRouter();



  useEffect(() => {

    let mounted = true;

    supabase.auth.getSession().then(({ data, error }) => {

      if (error) console.error("Unable to check login:", error);

      if (mounted) setLoggedIn(Boolean(data.session));

    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {

      if (mounted) setLoggedIn(Boolean(session));

    });

    return () => {

      mounted = false;

      authListener.subscription.unsubscribe();

    };

  }, []);



  async function handleLogout() {

    if (signingOut) return;

    setSigningOut(true);

    const { error } = await supabase.auth.signOut();

    if (error) {

      alert(`Unable to sign out: ${error.message}`);

      setSigningOut(false);

      return;

    }

    setLoggedIn(false);

    setMenuOpen(false);

    router.replace("/login");

    router.refresh();

  }

  const [projects, setProjects] = useState<Project[]>([]);

  const [walkthroughs, setWalkthroughs] = useState<Walkthrough[]>([]);

  const [selectedId, setSelectedId] = useState("");

  const [rates, setRates] = useState<Rates>(DEFAULT_RATES);

  const [ratesByProject, setRatesByProject] = useState<Record<string, Rates>>({});

  const [savingRates, setSavingRates] = useState(false);

  const [loaded, setLoaded] = useState(false);

  const [message, setMessage] = useState("");

  const [isAdmin, setIsAdmin] = useState(false);

  const [editableIds, setEditableIds] = useState<string[]>([]);

  const [loadError, setLoadError] = useState("");

  const [projectPhotos, setProjectPhotos] = useState<ProjectPhoto[]>([]);

  const [photoLoading, setPhotoLoading] = useState(false);

  const [photoError, setPhotoError] = useState("");

  const [preparingPrint, setPreparingPrint] = useState(false);



  useEffect(() => {

    let active = true;

    async function loadEstimateData() {

      setLoaded(false);

      try {

        const { data: userResult, error: authError } = await supabase.auth.getUser();

        if (authError || !userResult.user) throw new Error("Please sign in.");

        const userId = userResult.user.id;

        const { data: employee, error: employeeError } = await supabase

          .from("mercury_employees").select("role, status").eq("user_id", userId).single();

        if (employeeError || employee?.status !== "approved") throw new Error("Employee access not approved.");

        const admin = employee.role === "admin";

        const [projectResult, shareResult] = await Promise.all([

          supabase.from("mercury_projects").select("id, owner_id, name, customer_name, address, project_data"),

          admin ? Promise.resolve({ data: [] as {project_id:string;permission:string}[], error: null }) :

            supabase.from("mercury_project_shares").select("project_id, permission").eq("shared_with", userId),

        ]);

        if (projectResult.error) throw projectResult.error;

        if (shareResult.error) throw shareResult.error;

        const permissions = new Map((shareResult.data ?? []).map((row) => [row.project_id, row.permission]));

        const rows = (projectResult.data ?? []).filter((row) =>

          admin ? row.owner_id === userId : permissions.has(row.id)

        );

        const projectList: Project[] = rows.map((row) => {

          const details = row.project_data && typeof row.project_data === "object" && !Array.isArray(row.project_data)

            ? row.project_data as Partial<Project> : {};

          return { ...details, id: row.id, customerName: row.customer_name || details.customerName || row.name || "",

            address: row.address || details.address || "" };

        });

        const editable = admin ? projectList.map((item) => item.id) :

          projectList.filter((item) => permissions.get(item.id) === "edit").map((item) => item.id);

        const ids = projectList.map((item) => item.id);

        const { data: walkRows, error: walkError } = ids.length

          ? await supabase.from("mercury_walkthroughs").select("project_id, walkthrough_data").in("project_id", ids)

          : { data: [], error: null };

        if (walkError) throw walkError;

        const walkList: Walkthrough[] = (walkRows ?? []).map((row) => {

          const content = row.walkthrough_data && typeof row.walkthrough_data === "object" && !Array.isArray(row.walkthrough_data)

            ? row.walkthrough_data as { surfaces?: Surface[] } : {};

          return { projectId: row.project_id, surfaces: Array.isArray(content.surfaces) ? content.surfaces : [] };

        });

        const { data: rateRows, error: rateError } = ids.length

          ? await supabase.from("mercury_estimate_rates")

              .select("project_id, coverage, paint_price, labor_rate, prep_rate, waste_percent, markup_percent")

              .in("project_id", ids)

          : { data: [], error: null };

        if (rateError) throw rateError;

        const projectRates: Record<string, Rates> = {};

        for (const row of rateRows ?? []) {

          projectRates[row.project_id] = {

            coverage: Number(row.coverage), paintPrice: Number(row.paint_price),

            laborRate: Number(row.labor_rate), prepRate: Number(row.prep_rate),

            wastePercent: Number(row.waste_percent), markupPercent: Number(row.markup_percent),

          };

        }

        const requestedId = new URLSearchParams(window.location.search).get("projectId");

        const initialId = requestedId && ids.includes(requestedId) ? requestedId : ids[0] || "";

        if (active) {

          setIsAdmin(admin);

          setEditableIds(editable);

          setProjects(projectList);

          setWalkthroughs(walkList);

          setRatesByProject(projectRates);

          setSelectedId(initialId);

          setRates(projectRates[initialId] ?? { ...DEFAULT_RATES });

        }

      } catch (error) {

        console.error("Unable to load estimates:", error);

        if (active) { setProjects([]); setWalkthroughs([]); setLoadError(error instanceof Error ? error.message : "Unable to load estimates."); }

      } finally { if (active) setLoaded(true); }

    }

    void loadEstimateData();

    return () => { active = false; };

  }, []);



  // List photos from the private bucket for the selected project only.

  // Signed URLs are short-lived and must never be stored in the database.

  useEffect(() => {

    let active = true;

    async function loadProjectPhotos() {

      setProjectPhotos([]);

      setPhotoError("");

      if (!selectedId) return;

      setPhotoLoading(true);

      try {

        const bucket = supabase.storage.from("mercury-project-photos");

        const { data, error } = await bucket.list(selectedId, { limit: 100, sortBy: { column: "created_at", order: "asc" } });

        if (error) throw error;

        const paths = (data ?? [])

          .filter((item) => item.name && /\.(jpe?g|png|webp)$/i.test(item.name))

          .map((item) => `${selectedId}/${item.name}`);

        if (paths.length) {

          const { data: urls, error: urlError } = await bucket.createSignedUrls(paths, 3600);

          if (urlError) throw urlError;

          if (active) setProjectPhotos((urls ?? []).filter((item) => item.signedUrl).map((item) => ({ path: item.path ?? "", url: item.signedUrl! })));

        }

      } catch (error) {

        if (active) setPhotoError(error instanceof Error ? error.message : "Unable to load project photos.");

      } finally {

        if (active) setPhotoLoading(false);

      }

    }

    void loadProjectPhotos();

    return () => { active = false; };

  }, [selectedId]);



  const project = projects.find((item) => item.id === selectedId);

  const canEdit = editableIds.includes(selectedId);
  const usingDefaultRates = !Object.prototype.hasOwnProperty.call(ratesByProject, selectedId);



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



  async function saveRates() {

    if (!isAdmin || !selectedId || savingRates) return;

    setSavingRates(true);

    setMessage("");

    try {

      const { error } = await supabase.from("mercury_estimate_rates").upsert({

        project_id: selectedId,

        coverage: rates.coverage,

        paint_price: rates.paintPrice,

        labor_rate: rates.laborRate,

        prep_rate: rates.prepRate,

        waste_percent: rates.wastePercent,

        markup_percent: rates.markupPercent,

        updated_at: new Date().toISOString(),

      }, { onConflict: "project_id" });

      if (error) throw error;

      setRatesByProject((previous) => ({ ...previous, [selectedId]: { ...rates } }));

      setMessage("Pricing saved to this project in Supabase.");

    } catch (error) {

      console.error("Unable to save project pricing:", error);

      setMessage(error instanceof Error ? `Unable to save pricing: ${error.message}` : "Unable to save pricing.");

    } finally {

      setSavingRates(false);

    }

  }



  async function printEstimate() {

    if (!project || surfaces.length === 0 || preparingPrint) return;

    setPreparingPrint(true);

    try {

      // Wait for images to finish loading so browser PDF output includes them.

      const images = Array.from(document.querySelectorAll<HTMLImageElement>("#printable-estimate img"));

      await Promise.all(images.map((img) => img.complete ? Promise.resolve() : new Promise<void>((resolve) => {

        img.addEventListener("load", () => resolve(), { once: true });

        img.addEventListener("error", () => resolve(), { once: true });

      })));

      window.print();

    } finally {

      setPreparingPrint(false);

    }

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

            {navigation.filter((item) => isAdmin || item.href !== "/settings").map((item) => (

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



          {isAdmin && <Link

            href="/projects/new"

            className="hidden rounded-xl bg-[#ED1C24] px-6 py-4 text-sm font-black text-white shadow-lg hover:bg-red-700 sm:inline-flex"

          >

            + New Project

          </Link>}



          <div className="hidden lg:flex">

            {loggedIn === true ? (

              <button type="button" onClick={handleLogout} disabled={signingOut}

                className="rounded-xl border border-gray-200 px-5 py-4 text-sm font-black text-[#252525] hover:bg-gray-100 disabled:opacity-50">

                {signingOut ? "Logging Out..." : "Log Out"}

              </button>

            ) : loggedIn === false ? (

              <Link href="/login" className="rounded-xl border border-gray-200 px-5 py-4 text-sm font-black text-[#252525] hover:bg-gray-100">

                Log In

              </Link>

            ) : null}

          </div>



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

              ...navigation.filter((item) => isAdmin || item.href !== "/settings"),

              ...(canEdit ? [{ label: "AI Walkthrough", href: `/walkthrough?projectId=${selectedId}` }] : []),

              ...(isAdmin ? [{ label: "New Project", href: "/projects/new" }] : []),

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

            {loggedIn === true ? (

              <button type="button" onClick={handleLogout} disabled={signingOut}

                className="block w-full rounded-xl px-4 py-4 text-left font-bold hover:bg-red-50 hover:text-[#ED1C24] disabled:opacity-50">

                {signingOut ? "Logging Out..." : "Log Out"}

              </button>

            ) : loggedIn === false ? (

              <Link href="/login" onClick={() => setMenuOpen(false)}

                className="block rounded-xl px-4 py-4 font-bold hover:bg-red-50 hover:text-[#ED1C24]">

                Log In

              </Link>

            ) : null}

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



          {loadError && <p role="alert" className="mt-4 text-red-700">{loadError}</p>}

          {!loaded ? (

            <p className="mt-5 text-gray-500">Loading projects...</p>

          ) : projects.length === 0 ? (

            <div className="mt-5 rounded-xl bg-yellow-50 p-5">

              <p className="font-bold">

                No projects have been created yet.

              </p>



              {isAdmin && <Link

                href="/projects/new"

                className="mt-4 inline-flex rounded-xl bg-[#ED1C24] px-5 py-3 font-black text-white"

              >

                + Create Project

              </Link>}

            </div>

          ) : (

            <select

              value={selectedId}

              disabled={savingRates}

              onChange={(event) => {

                const nextId = event.target.value;

                setSelectedId(nextId);

                setRates(ratesByProject[nextId] ?? { ...DEFAULT_RATES });

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



            {/* Preliminary pricing warning — Washington benchmark defaults are estimates, not approved prices. */}
              <div className="no-print mt-8 rounded-2xl border-2 border-amber-300 bg-amber-50 p-6 text-amber-950" role="status">
                <p className="font-black">WASHINGTON BASELINE — PRICING REVIEW REQUIRED</p>
                <p className="mt-2 text-sm leading-6">
                  {usingDefaultRates
                    ? "This project is using provisional Washington State residential painting benchmarks, not confirmed Mercury Painting rates. Review before quoting a customer."
                    : "This project has saved pricing rates. Confirm that they are accurate and approved before giving the estimate to a customer."}
                  {" "}AI photo observations and preparation recommendations must also be verified on site.
                </p>
              </div>

              {/* ESTIMATING RATES */}

            <section className="no-print mt-8 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-md">



              <div className="border-b border-gray-100 px-6 py-6">

                <h2 className="text-2xl font-black">

                  ⚙️ Estimating Rates

                </h2>

                <p className="mt-2 text-sm text-gray-500">

                  {isAdmin

                    ? "Starting values use provisional Washington residential interior-painting benchmarks. Only administrators can change project rates."

                    : "Project pricing is controlled by the administrator. Washington baseline rates are estimates, not mandated state prices."}

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

                      disabled={!isAdmin}

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

                {isAdmin && <button

                  type="button"

                  onClick={saveRates}

                  disabled={savingRates}

                  className="rounded-xl bg-[#ED1C24] px-6 py-4 font-black text-white hover:bg-red-700 disabled:opacity-50"

                >

                  {savingRates ? "SAVING..." : "SAVE PROJECT PRICING"}

                </button>}



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

                    <p>Estimate Status: Preliminary — Pricing Requires Review</p>

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



                      {canEdit && <Link

                        href={`/walkthrough?projectId=${selectedId}`}

                        className="mt-4 inline-flex rounded-xl bg-[#ED1C24] px-5 py-3 font-black text-white"

                      >

                        START WALKTHROUGH →

                      </Link>}

                    </div>

                  )}

                </div>



                                 {/* CUSTOMER PRICE: no internal rates, costs, or markup in print */}

                 {surfaces.length > 0 && (

                   <div className="mt-10">

                     <h3 className="text-xl font-black uppercase">Estimated Project Price</h3>

                     <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-xl bg-[#252525] p-6 text-white">

                       <p className="text-xl font-black">TOTAL ESTIMATED PRICE</p>

                       <p className="text-3xl font-black text-[#FFD400]">{money(total)}</p>

                     </div>

                     <p className="mt-5 text-xs leading-6 text-gray-500">

                       Preliminary estimate based on recorded measurements and site observations.

                       Draft pricing only. Confirm approved labor and material rates, site conditions, access, taxes, and fees before issuing a final quote.

                     </p>

                   </div>

                 )}



                 {/* Customer-facing project documentation from private Storage */}

                 <div className="mt-10">

                   <h3 className="text-xl font-black uppercase">Project Photos</h3>

                   {photoLoading && <p className="mt-3 text-sm text-gray-500">Loading project photos...</p>}

                   {photoError && <p className="no-print mt-3 text-sm text-red-700">Unable to load photos: {photoError}</p>}

                   {!photoLoading && !photoError && projectPhotos.length === 0 && (

                     <p className="mt-3 text-sm text-gray-500">No project photos available.</p>

                   )}

                   {projectPhotos.length > 0 && (

                     <div className="mt-5 grid grid-cols-2 gap-4">

                       {projectPhotos.map((item, index) => (

                         <figure key={item.path || index} className="break-inside-avoid overflow-hidden rounded-xl border border-gray-200">

                           {/* eslint-disable-next-line @next/next/no-img-element */}

                           <img src={item.url} alt={`Project photo ${index + 1}`} className="h-52 w-full object-contain" />

                           <figcaption className="px-3 py-2 text-xs text-gray-500">Project photo {index + 1}</figcaption>

                         </figure>

                       ))}

                     </div>

                   )}

                 </div>



                 {surfaces.some((surface) => /AI photo observations/i.test(surface.notes ?? "")) && (

                   <div className="mt-10">

                     <h3 className="text-xl font-black uppercase">Photo Review Observations</h3>

                     <p className="mt-2 text-xs text-gray-500">AI-assisted observations are preliminary and must be verified on site.</p>

                     {surfaces.filter((surface) => /AI photo observations/i.test(surface.notes ?? "")).map((surface) => (

                       <div key={surface.id} className="mt-4 break-inside-avoid rounded-xl border border-gray-200 p-4">

                         <p className="font-bold">{surface.name}</p>

                         <p className="mt-2 whitespace-pre-wrap text-sm text-gray-600">{surface.notes}</p>

                       </div>

                     ))}

                   </div>

                 )}

              </div>

            </section>



            {/* Internal costs are visible to admins on screen, never in the PDF. */}

            {isAdmin && surfaces.length > 0 && (

              <section className="no-print mt-8 rounded-2xl border border-gray-200 bg-white p-6 shadow-md">

                <h3 className="text-xl font-black">Internal Cost Breakdown — Admin Only</h3>

                <p className="mt-2 text-sm text-gray-500">Not included in the customer PDF.</p>

                <div className="mt-5 space-y-3 text-sm">

                  {[

                    ["Paint materials", paintCost], ["Painting labor", laborCost],

                    ["Surface preparation", preparationCost], ["Internal subtotal", subtotal],

                    [`Markup (${rates.markupPercent}%)`, markup], ["Quoted total", total],

                  ].map(([label, amount]) => (

                    <div key={String(label)} className="flex justify-between border-b border-gray-100 pb-2">

                      <span>{label}</span><strong>{money(Number(amount))}</strong>

                    </div>

                  ))}

                </div>

              </section>

            )}



            {/* PRINT BUTTON */}

            {surfaces.length > 0 && (

              <div className="no-print mt-8 flex flex-wrap gap-4">



                <button

                  type="button"

                  onClick={() => void printEstimate()}

                  disabled={preparingPrint || photoLoading}

                  className="rounded-xl bg-[#ED1C24] px-8 py-5 font-black text-white shadow-lg hover:bg-red-700"

                >

                  {preparingPrint ? "PREPARING PDF..." : "🖨️ PRINT / SAVE AS PDF"}

                </button>



                {canEdit && <Link

                  href={`/walkthrough?projectId=${selectedId}`}

                  className="rounded-xl border-2 border-[#252525] bg-white px-8 py-5 font-black"

                >

                  ← EDIT WALKTHROUGH

                </Link>}

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