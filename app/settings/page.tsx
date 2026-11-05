"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabase";

type Rates = {
  coverage: number;
  paintPrice: number;
  laborRate: number;
  prepRate: number;
  wastePercent: number;
  markupPercent: number;
};

type Employee = {
  user_id: string;
  role: "admin" | "employee";
  status: "pending" | "approved" | "disabled";
  created_at: string;
};

const STORAGE_KEY = "mercury_estimate_rates";

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

const fields: {
  key: keyof Rates;
  label: string;
  description: string;
  unit: string;
}[] = [
  {
    key: "coverage",
    label: "Paint Coverage",
    description: "Estimated square feet covered by one gallon for one coat.",
    unit: "sq ft / gallon",
  },
  {
    key: "paintPrice",
    label: "Paint Cost",
    description: "Average material cost for one gallon of paint.",
    unit: "$ / gallon",
  },
  {
    key: "laborRate",
    label: "Painting Labor",
    description: "Labor cost per square foot of measured surface.",
    unit: "$ / sq ft",
  },
  {
    key: "prepRate",
    label: "Surface Preparation",
    description: "Additional cost per square foot requiring preparation.",
    unit: "$ / sq ft",
  },
  {
    key: "wastePercent",
    label: "Paint Waste Allowance",
    description: "Additional paint allowance for waste and touch-ups.",
    unit: "%",
  },
  {
    key: "markupPercent",
    label: "Project Markup",
    description: "Percentage added to calculated material and labor costs.",
    unit: "%",
  },
];

function money(value: number) {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

export default function SettingsPage() {
  const router = useRouter();
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [rates, setRates] = useState<Rates>(DEFAULT_RATES);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState("");
  const [hasChanges, setHasChanges] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeLoading, setEmployeeLoading] = useState(true);
  const [employeeError, setEmployeeError] = useState("");
  const [employeeMessage, setEmployeeMessage] = useState("");
  const [updatingEmployee, setUpdatingEmployee] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);

      if (saved) {
        const parsed = JSON.parse(saved);

        if (parsed && typeof parsed === "object") {
          const next = { ...DEFAULT_RATES };

          for (const field of fields) {
            const value = parsed[field.key];

            if (
              typeof value === "number" &&
              Number.isFinite(value) &&
              value >= 0
            ) {
              next[field.key] = value;
            }
          }

          setRates(next);
        }
      }
    } catch (error) {
      console.error("Unable to load settings:", error);
      setMessage("Unable to load saved rates. Showing defaults.");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return;
      if (error) console.error("Unable to check login:", error);
      setLoggedIn(Boolean(data.session));
    });
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) setLoggedIn(Boolean(session));
    });
    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let active = true;

    async function loadEmployees() {
      setEmployeeLoading(true);
      setEmployeeError("");

      const { data: userResult, error: userError } = await supabase.auth.getUser();
      if (!active) return;
      if (userError || !userResult.user) {
        setIsAdmin(false);
        setEmployeeLoading(false);
        return;
      }

      setCurrentUserId(userResult.user.id);
      const { data: adminResult, error: adminError } = await supabase.rpc(
        "mercury_is_admin"
      );
      if (!active) return;
      if (adminError) {
        setEmployeeError(`Unable to check administrator access: ${adminError.message}`);
        setEmployeeLoading(false);
        return;
      }

      if (adminResult !== true) {
        setIsAdmin(false);
        setEmployeeLoading(false);
        return;
      }

      setIsAdmin(true);
      const { data, error } = await supabase
        .from("mercury_employees")
        .select("user_id, role, status, created_at")
        .order("created_at", { ascending: false });
      if (!active) return;
      if (error) {
        setEmployeeError(`Unable to load employees: ${error.message}`);
      } else {
        setEmployees((data ?? []) as Employee[]);
      }
      setEmployeeLoading(false);
    }

    void loadEmployees();
    return () => { active = false; };
  }, []);

  async function changeEmployeeStatus(employee: Employee, nextStatus: Employee["status"]) {
    if (!isAdmin || updatingEmployee || employee.role !== "employee") return;
    if (employee.user_id === currentUserId) return;
    if (!window.confirm(`Change this employee's status to ${nextStatus}?`)) return;

    setUpdatingEmployee(employee.user_id);
    setEmployeeError("");
    setEmployeeMessage("");

    const { error } = await supabase.rpc("mercury_set_employee_status", {
      target_user_id: employee.user_id,
      new_status: nextStatus,
    });

    if (error) {
      setEmployeeError(`Unable to update employee: ${error.message}`);
      setUpdatingEmployee(null);
      return;
    }

    const { data, error: reloadError } = await supabase
      .from("mercury_employees")
      .select("user_id, role, status, created_at")
      .order("created_at", { ascending: false });

    if (reloadError) {
      setEmployeeError(`Status changed, but unable to refresh list: ${reloadError.message}`);
    } else {
      setEmployees((data ?? []) as Employee[]);
      setEmployeeMessage("Employee status updated successfully.");
    }
    setUpdatingEmployee(null);
  }

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

  function updateRate(key: keyof Rates, value: string) {
    const number = Number(value);

    setRates((previous) => ({
      ...previous,
      [key]: Number.isFinite(number) ? number : 0,
    }));

    setHasChanges(true);
    setMessage("");
  }

  function saveSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (
      Object.values(rates).some(
        (value) => !Number.isFinite(value) || value < 0
      ) ||
      rates.coverage <= 0
    ) {
      setMessage(
        "Enter valid nonnegative rates. Paint coverage must be greater than zero."
      );
      return;
    }

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(rates));
      setHasChanges(false);
      setMessage("Settings saved successfully.");
    } catch (error) {
      console.error("Unable to save settings:", error);
      setMessage("Unable to save settings in this browser.");
    }
  }

  function restoreDefaults() {
    if (
      !window.confirm(
        "Restore the example estimating rates? You will need to save them to make the change permanent."
      )
    ) {
      return;
    }

    setRates({ ...DEFAULT_RATES });
    setHasChanges(true);
    setMessage("Example rates restored. Click Save Settings to keep them.");
  }

  // Live calculation example: 200 sq ft, two coats, no preparation.
  const exampleArea = 200;
  const exampleCoats = 2;
  const exampleCoatedArea = exampleArea * exampleCoats;

  const gallons = Math.ceil(
    (exampleCoatedArea / Math.max(rates.coverage, 0.01)) *
      (1 + rates.wastePercent / 100)
  );

  const paintCost = gallons * rates.paintPrice;
  const laborCost = exampleArea * rates.laborRate;
  const subtotal = paintCost + laborCost;
  const markup = subtotal * (rates.markupPercent / 100);
  const estimatedTotal = subtotal + markup;

  return (
    <main className="min-h-screen bg-[#F5F5F5] text-[#252525]">
      {/* HEADER — SAME AS APPROVED PAGES */}
      <header className="relative z-30 border-b border-gray-200 bg-white">
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
                  item.href === "/settings"
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
            className="hidden rounded-xl bg-[#ED1C24] px-6 py-4 text-sm font-black text-white shadow-lg transition hover:bg-red-700 sm:inline-flex"
          >
            + New Project
          </Link>

          <div className="hidden shrink-0 lg:flex">
            {loggedIn === true ? (
              <button type="button" onClick={handleLogout} disabled={signingOut}
                className="rounded-xl border-2 border-[#ED1C24] px-5 py-3 text-sm font-black text-[#ED1C24] transition hover:bg-red-50 disabled:opacity-50">
                {signingOut ? "Logging Out..." : "Log Out"}
              </button>
            ) : loggedIn === false ? (
              <Link href="/login" className="rounded-xl border-2 border-[#ED1C24] px-5 py-3 text-sm font-black text-[#ED1C24] transition hover:bg-red-50">
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
            {loggedIn === true ? (
              <button type="button" onClick={handleLogout} disabled={signingOut}
                className="block w-full rounded-xl px-4 py-4 text-left font-bold text-[#ED1C24] hover:bg-red-50 disabled:opacity-50">
                {signingOut ? "Logging Out..." : "Log Out"}
              </button>
            ) : loggedIn === false ? (
              <Link href="/login" onClick={() => setMenuOpen(false)}
                className="block rounded-xl px-4 py-4 font-bold text-[#ED1C24] hover:bg-red-50">
                Log In
              </Link>
            ) : null}
          </nav>
        )}
      </header>

      {/* PAGE CONTENT */}
      <section className="mx-auto max-w-7xl px-5 py-12">
        <div className="mb-10">
          <div className="mb-4 flex items-center gap-3">
            <span className="h-1.5 w-12 bg-[#ED1C24]" />
            <p className="text-sm font-black uppercase tracking-widest text-[#ED1C24]">
              Estimator Configuration
            </p>
          </div>

          <h1 className="text-3xl font-black uppercase tracking-tight sm:text-5xl">
            Estimator Settings
          </h1>

          <p className="mt-4 max-w-2xl leading-7 text-gray-600">
            Configure the material, labor, and pricing assumptions used
            to calculate Mercury Painting estimates.
          </p>

          <div className="mt-6 h-2 w-28 bg-[#FFD400]" />
        </div>

        {/* SETTINGS FORM */}
        <form onSubmit={saveSettings}>
          <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-md">
            <div className="border-b border-gray-100 px-6 py-6">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-yellow-100 text-3xl">
                  ⚙️
                </div>

                <div>
                  <h2 className="text-xl font-black sm:text-2xl">
                    Standard Estimating Rates
                  </h2>

                  <p className="mt-1 text-sm text-gray-500">
                    These values will be used by the Estimates page.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-6 p-6 md:grid-cols-2">
              {fields.map((field) => (
                <div
                  key={field.key}
                  className="rounded-xl border border-gray-100 bg-[#FAFAFA] p-5"
                >
                  <label
                    htmlFor={field.key}
                    className="block text-sm font-black"
                  >
                    {field.label}
                  </label>

                  <p className="mt-2 min-h-10 text-sm leading-5 text-gray-500">
                    {field.description}
                  </p>

                  <div className="mt-4 flex items-center gap-3">
                    <input
                      id={field.key}
                      type="number"
                      min={field.key === "coverage" ? "0.01" : "0"}
                      step="0.01"
                      required
                      disabled={!loaded}
                      value={rates[field.key]}
                      onChange={(event) =>
                        updateRate(field.key, event.target.value)
                      }
                      className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-white px-4 py-3 text-lg font-black outline-none focus:border-[#ED1C24]"
                    />

                    <span className="min-w-24 text-right text-xs font-bold text-gray-500">
                      {field.unit}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t border-gray-100 p-6">
              <div className="flex flex-wrap gap-4">
                <button
                  type="submit"
                  disabled={!loaded}
                  className="rounded-xl bg-[#ED1C24] px-7 py-4 font-black text-white shadow-md transition hover:bg-red-700 disabled:opacity-50"
                >
                  SAVE SETTINGS
                </button>

                <button
                  type="button"
                  onClick={restoreDefaults}
                  className="rounded-xl border-2 border-[#252525] bg-white px-7 py-4 font-black transition hover:bg-gray-100"
                >
                  RESTORE DEFAULTS
                </button>
              </div>

              {hasChanges && (
                <p className="mt-4 text-sm font-bold text-amber-700">
                  You have unsaved changes.
                </p>
              )}

              {message && (
                <p
                  role="status"
                  className="mt-4 rounded-xl bg-gray-100 p-4 text-sm font-bold"
                >
                  {message}
                </p>
              )}
            </div>
          </div>
        </form>

        {/* LIVE ESTIMATE PREVIEW */}
        <section className="mt-8 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-md">
          <div className="border-b border-gray-100 px-6 py-6">
            <h2 className="text-2xl font-black">
              📊 Live Pricing Preview
            </h2>

            <p className="mt-2 text-sm text-gray-500">
              Example: a 20 ft × 10 ft wall, two coats, with no
              preparation required.
            </p>
          </div>

          <div className="grid gap-5 p-6 sm:grid-cols-3">
            <div className="rounded-xl bg-[#F5F5F5] p-5">
              <p className="text-sm font-bold text-gray-500">
                Surface Area
              </p>

              <p className="mt-3 text-3xl font-black">
                200 <span className="text-base">sq ft</span>
              </p>

              <div className="mt-4 h-1.5 w-16 bg-[#ED1C24]" />
            </div>

            <div className="rounded-xl bg-[#F5F5F5] p-5">
              <p className="text-sm font-bold text-gray-500">
                Paint Required
              </p>

              <p className="mt-3 text-3xl font-black">
                {Number.isFinite(gallons)
                  ? gallons.toLocaleString()
                  : "—"}{" "}
                <span className="text-base">gallons</span>
              </p>

              <div className="mt-4 h-1.5 w-16 bg-[#FFD400]" />
            </div>

            <div className="rounded-xl bg-[#252525] p-5 text-white">
              <p className="text-sm font-bold text-gray-300">
                Estimated Price
              </p>

              <p className="mt-3 text-3xl font-black text-[#FFD400]">
                {Number.isFinite(estimatedTotal)
                  ? money(estimatedTotal)
                  : "—"}
              </p>

              <div className="mt-4 h-1.5 w-16 bg-[#ED1C24]" />
            </div>
          </div>

          <div className="space-y-3 border-t border-gray-100 px-6 py-6 text-sm">
            <div className="flex justify-between gap-4">
              <span>Paint Materials</span>
              <strong>{money(paintCost)}</strong>
            </div>

            <div className="flex justify-between gap-4">
              <span>Painting Labor</span>
              <strong>{money(laborCost)}</strong>
            </div>

            <div className="flex justify-between gap-4">
              <span>Markup ({rates.markupPercent}%)</span>
              <strong>{money(markup)}</strong>
            </div>

            <div className="flex justify-between gap-4 border-t border-gray-200 pt-4 text-lg font-black">
              <span>Example Total</span>
              <span className="text-[#ED1C24]">
                {money(estimatedTotal)}
              </span>
            </div>
          </div>
        </section>

        {/* ADMINISTRATOR-ONLY EMPLOYEE MANAGEMENT */}
        {isAdmin && (
          <section className="mt-8 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-md">
            <div className="border-b border-gray-100 px-6 py-6">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-yellow-100 text-3xl">👥</div>
                <div>
                  <h2 className="text-xl font-black sm:text-2xl">Employee Management</h2>
                  <p className="mt-1 text-sm text-gray-500">Administrator only — approve, disable, or reactivate employee accounts.</p>
                </div>
              </div>
            </div>
            <div className="p-6">
              <p className="mb-5 text-sm leading-6 text-gray-600">
                Employee accounts must first be invited or created through Supabase Authentication.
                Only accounts registered in the Mercury employee table appear here.
              </p>
              {employeeError && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-4 text-sm font-bold text-red-700">{employeeError}</p>}
              {employeeMessage && <p role="status" className="mb-4 rounded-xl bg-green-50 p-4 text-sm font-bold text-green-800">{employeeMessage}</p>}
              {employeeLoading ? (
                <p className="text-sm text-gray-500">Loading employee accounts...</p>
              ) : employees.length === 0 ? (
                <p className="text-sm text-gray-500">No employee records found.</p>
              ) : (
                <div className="space-y-4">
                  {employees.map((employee) => (
                    <div key={employee.user_id} className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-[#FAFAFA] p-5 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-black">{employee.role === "admin" ? "Administrator" : "Employee"}</p>
                        <p className="mt-1 break-all font-mono text-xs text-gray-500">{employee.user_id}</p>
                        <p className="mt-2 text-sm font-bold capitalize">Status: <span className={employee.status === "approved" ? "text-green-700" : employee.status === "disabled" ? "text-red-700" : "text-amber-700"}>{employee.status}</span></p>
                      </div>
                      {employee.role === "employee" && employee.user_id !== currentUserId && (
                        <div className="flex flex-wrap gap-2">
                          {employee.status !== "approved" && (
                            <button type="button" disabled={Boolean(updatingEmployee)} onClick={() => void changeEmployeeStatus(employee, "approved")} className="rounded-lg bg-green-700 px-4 py-3 text-sm font-black text-white hover:bg-green-800 disabled:opacity-50">
                              {updatingEmployee === employee.user_id ? "Updating..." : "Approve"}
                            </button>
                          )}
                          {employee.status !== "disabled" && (
                            <button type="button" disabled={Boolean(updatingEmployee)} onClick={() => void changeEmployeeStatus(employee, "disabled")} className="rounded-lg bg-[#ED1C24] px-4 py-3 text-sm font-black text-white hover:bg-red-700 disabled:opacity-50">
                              {updatingEmployee === employee.user_id ? "Updating..." : "Disable"}
                            </button>
                          )}
                          {employee.status !== "pending" && (
                            <button type="button" disabled={Boolean(updatingEmployee)} onClick={() => void changeEmployeeStatus(employee, "pending")} className="rounded-lg border border-gray-300 px-4 py-3 text-sm font-black hover:bg-gray-100 disabled:opacity-50">
                              Set Pending
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {/* IMPORTANT NOTICE */}
        <div className="mt-8 rounded-2xl border border-yellow-200 bg-yellow-50 p-6">
          <h3 className="font-black">
            Important: Confirm Mercury Painting&apos;s Actual Rates
          </h3>

          <p className="mt-2 text-sm leading-7 text-gray-600">
            The default values are examples for testing. Before using
            estimates with real customers, confirm labor costs, material
            pricing, coverage, preparation requirements, overhead,
            markup, and applicable taxes. Changes made here are saved
            in this browser only.
          </p>
        </div>

        <div className="mt-8 flex flex-wrap gap-4">
          <Link
            href="/estimates"
            className="rounded-xl bg-[#ED1C24] px-7 py-4 font-black text-white transition hover:bg-red-700"
          >
            VIEW ESTIMATES →
          </Link>

          <Link
            href="/walkthrough"
            className="rounded-xl border-2 border-[#252525] bg-white px-7 py-4 font-black transition hover:bg-gray-100"
          >
            AI WALKTHROUGH
          </Link>
        </div>
      </section>

      {/* FOOTER — APPROVED MERCURY DESIGN */}
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
    </main>
  );
}