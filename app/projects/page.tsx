"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabase";
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
  sharedWithMe?: boolean;
  ownerId: string;
  sharePermission?: "view" | "edit";
};
export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [search, setSearch] = useState("");
  const [sharingProject, setSharingProject] = useState<Project | null>(null);
  const [employees, setEmployees] = useState<{ user_id: string; email: string }[]>([]);
  const [shares, setShares] = useState<{ id: string; shared_with: string; permission: string }[]>([]);
  const [recipient, setRecipient] = useState("");
  const [permission, setPermission] = useState<"view" | "edit">("view");
  const [sharingBusy, setSharingBusy] = useState(false);
  const [sharingLoading, setSharingLoading] = useState(false);
  const [sharingError, setSharingError] = useState("");
  const [sharingNotice, setSharingNotice] = useState("");
  const [shareMode, setShareMode] = useState<"choose" | "existing" | "invite">("choose");
  const [inviteEmail, setInviteEmail] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const router = useRouter();
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
  useEffect(() => {
    let active = true;
    async function loadProjects() {
      setLoaded(false);
      try {
        const { data: userData, error: authError } =
          await supabase.auth.getUser();
        if (authError || !userData.user) {
          throw new Error("Please sign in to view projects.");
        }
        const { data: employee, error: employeeError } = await supabase
          .from("mercury_employees")
          .select("role, status")
          .eq("user_id", userData.user.id)
          .single();
        if (employeeError || employee?.status !== "approved") {
          throw new Error("Your employee account is not approved.");
        }
        const admin = employee.role === "admin";
        if (active) setIsAdmin(admin);

        const { data: sharedRows, error: shareError } = admin
          ? { data: [] as { project_id: string; permission: string }[], error: null }
          : await supabase.from("mercury_project_shares")
              .select("project_id, permission")
              .eq("shared_with", userData.user.id);
        if (shareError) throw shareError;
        const permissions = new Map((sharedRows ?? []).map((share) => [share.project_id, share.permission]));

        const { data, error } = await supabase
          .from("mercury_projects")
          .select("id, owner_id, name, customer_name, address, status, project_data");
        if (error) throw error;
        const cloudProjects: Project[] = (data ?? [])
          .filter((row) => admin ? row.owner_id === userData.user.id : permissions.has(row.id))
          .map((row) => {
          const details =
            row.project_data &&
            typeof row.project_data === "object" &&
            !Array.isArray(row.project_data)
              ? (row.project_data as Partial<Project>)
              : {};
          return {
            ...details,
            id: row.id,
            sharedWithMe: row.owner_id !== userData.user.id,
            ownerId: row.owner_id,
            sharePermission: admin ? "edit" : permissions.get(row.id) === "edit" ? "edit" : "view",
            customerName:
              row.customer_name || details.customerName || "",
            address: row.address || details.address || "",
            projectType: details.projectType || "",
            paintingType: details.paintingType || "",
            status: row.status || details.status || "Draft",
            createdAt: details.createdAt || "",
          };
        });
        if (active) setProjects(cloudProjects);
      } catch (error) {
        console.error("Unable to load Supabase projects:", error);
        if (active) {
          setProjects([]);
          alert(
            "Unable to load projects from Supabase. Your existing browser data has not been deleted."
          );
        }
      } finally {
        if (active) setLoaded(true);
      }
    }
    void loadProjects();
    return () => {
      active = false;
    };
  }, []);
  async function openSharing(project: Project) {
    if (!isAdmin || project.sharedWithMe) return;
    setSharingProject(project);
    setSharingLoading(true);
    setSharingError("");
    setSharingNotice("");
    setShareMode("choose");
    setInviteEmail("");
    setRecipient("");
    setPermission("view");
    const [directoryResult, sharesResult] = await Promise.all([
      supabase.rpc("mercury_approved_employee_directory"),
      supabase.from("mercury_project_shares")
        .select("id, shared_with, permission")
        .eq("project_id", project.id),
    ]);
    if (directoryResult.error || sharesResult.error) {
      setSharingError(directoryResult.error?.message || sharesResult.error?.message || "Unable to load sharing settings.");
    } else {
      setEmployees(directoryResult.data ?? []);
      setShares(sharesResult.data ?? []);
    }
    setSharingLoading(false);
  }
  async function sendEmployeeInvitation() {
    if (!sharingProject || sharingBusy) return;
    const email = inviteEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setSharingError("Enter a valid email address.");
      return;
    }
    setSharingBusy(true);
    setSharingError("");
    setSharingNotice("");
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (sessionError || !token) throw new Error("Please sign in again.");
      const response = await fetch("/api/employees/invite", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ email }),
      });
      const result: { error?: string; message?: string } = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to send invitation.");
      setSharingNotice(`Invitation sent to ${email}. Once the employee accepts and is approved, return here to grant project access.`);
      setInviteEmail("");
      setShareMode("choose");
    } catch (error) {
      setSharingError(error instanceof Error ? error.message : "Unable to send invitation.");
    } finally {
      setSharingBusy(false);
    }
  }
  async function grantAccess() {
    if (!sharingProject || !recipient || sharingBusy) return;
    setSharingBusy(true);
    setSharingError("");
    const { data, error } = await supabase.from("mercury_project_shares")
      .insert({ project_id: sharingProject.id, shared_with: recipient, permission })
      .select("id, shared_with, permission")
      .single();
    if (error) {
      setSharingError(error.code === "23505" ? "This employee already has access." : error.message);
    } else if (data) {
      setShares((current) => [...current, data]);
      setRecipient("");
      setPermission("view");
    }
    setSharingBusy(false);
  }
  async function changeAccess(shareId: string, nextPermission: "view" | "edit") {
    if (sharingBusy) return;
    setSharingBusy(true);
    setSharingError("");
    const { error } = await supabase.from("mercury_project_shares")
      .update({ permission: nextPermission }).eq("id", shareId);
    if (error) setSharingError(error.message);
    else setShares((current) => current.map((share) =>
      share.id === shareId ? { ...share, permission: nextPermission } : share
    ));
    setSharingBusy(false);
  }
  async function removeAccess(shareId: string) {
    if (sharingBusy || !window.confirm("Remove this employee's access to the project?")) return;
    setSharingBusy(true);
    setSharingError("");
    const { error } = await supabase.from("mercury_project_shares")
      .delete().eq("id", shareId);
    if (error) setSharingError(error.message);
    else setShares((current) => current.filter((share) => share.id !== shareId));
    setSharingBusy(false);
  }
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
            {navigation.filter((item) => isAdmin || item.href !== "/settings").map((item) => (
              <Link key={item.href} href={item.href} className={`border-b-4 py-2 text-sm font-bold transition ${item.href === ACTIVE_ROUTE ? "border-[#FFD400] text-[#ED1C24]" : "border-transparent text-gray-600 hover:text-[#ED1C24]"}`}>
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="hidden items-center gap-3 lg:flex">
            {isAdmin && <Link href="/projects/new" className="rounded-xl bg-[#ED1C24] px-5 py-4 text-sm font-black text-white shadow-lg transition hover:bg-red-700">+ New Project</Link>}
            {loggedIn === false && (
              <Link href="/login" className="rounded-xl border-2 border-[#ED1C24] px-5 py-3.5 text-sm font-black text-[#ED1C24] hover:bg-red-50">Log In</Link>
            )}
            {loggedIn === true && (
              <button type="button" onClick={handleLogout} disabled={signingOut} className="rounded-xl border-2 border-[#ED1C24] px-5 py-3.5 text-sm font-black text-[#ED1C24] hover:bg-red-50 disabled:opacity-50">
                {signingOut ? "Signing Out..." : "Log Out"}
              </button>
            )}
          </div>
          <button type="button" onClick={() => setMenuOpen(!menuOpen)} aria-label={menuOpen ? "Close navigation" : "Open navigation"} aria-expanded={menuOpen} className="rounded-xl border border-gray-200 px-4 py-3 text-xl lg:hidden">{menuOpen ? "✕" : "☰"}</button>
        </div>
        {menuOpen && (
          <nav className="absolute left-0 right-0 top-full border-t border-gray-200 bg-white p-5 shadow-xl lg:hidden">
            {[...navigation, {label:"AI Walkthrough",href:"/walkthrough"}, {label:"New Project",href:"/projects/new"}].map(item => (
              <Link key={item.href} href={item.href} onClick={() => setMenuOpen(false)} className="block rounded-xl px-4 py-4 font-bold hover:bg-red-50 hover:text-[#ED1C24]">{item.label}</Link>
            ))}
            {loggedIn === false && (
              <Link href="/login" onClick={() => setMenuOpen(false)} className="mt-3 block rounded-xl bg-[#ED1C24] px-4 py-4 text-center font-black text-white">Log In</Link>
            )}
            {loggedIn === true && (
              <button type="button" onClick={handleLogout} disabled={signingOut} className="mt-3 block w-full rounded-xl bg-[#ED1C24] px-4 py-4 text-center font-black text-white disabled:opacity-50">
                {signingOut ? "Signing Out..." : "Log Out"}
              </button>
            )}
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
              {isAdmin && projects.length === 0 && (
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
                        {project.sharedWithMe && (
                          <span className="mt-1 inline-block rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
                            Shared With Me
                          </span>
                        )}
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
                 
<Link
  href={`/estimates?projectId=${project.id}`}
  title="Open this project's estimate"
  className="inline-block rounded-full border border-yellow-300 bg-yellow-50 px-4 py-2 text-sm font-bold text-[#292D32] hover:bg-yellow-100 focus:outline-none focus:ring-2 focus:ring-[#ED1C24]"
>
  {project.status || "Draft"} ↗
</Link>

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
                  <div className="flex flex-wrap items-center gap-3">
                    {isAdmin && !project.sharedWithMe && (
                      <button type="button" onClick={() => void openSharing(project)}
                        className="rounded-xl border-2 border-[#ED1C24] px-5 py-3 text-sm font-black text-[#ED1C24] hover:bg-red-50">
                        Share Project
                      </button>
                    )}
                  {(isAdmin || project.sharePermission === "edit") && <Link
  href={`/walkthrough?projectId=${project.id}`}
  className="inline-flex items-center gap-2 rounded-xl bg-[#ED1C24] px-5 py-3 text-sm font-black text-white shadow-md transition hover:bg-red-700"
>
  📷 START AI WALKTHROUGH →
</Link>}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
      {sharingProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="presentation" onMouseDown={(event) => {
            if (event.target === event.currentTarget && !sharingBusy) setSharingProject(null);
          }}>
          <section role="dialog" aria-modal="true" aria-labelledby="sharing-title"
            className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="sharing-title" className="text-2xl font-black">Share Project</h2>
                <p className="mt-1 text-sm text-gray-500">{sharingProject.customerName}</p>
              </div>
              <button type="button" onClick={() => setSharingProject(null)} disabled={sharingBusy}
                aria-label="Close sharing panel" className="rounded-lg px-3 py-2 text-xl hover:bg-gray-100 disabled:opacity-50">✕</button>
            </div>
            {sharingLoading ? <p className="mt-6 text-gray-500">Loading employees and permissions...</p> : (
              <>
                <div className="mt-6 space-y-4">
                  <p className="text-sm font-semibold text-gray-600">Choose how to share this project:</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <button type="button" disabled={sharingBusy}
                      onClick={() => { setShareMode("existing"); setSharingError(""); setSharingNotice(""); }}
                      className={`rounded-xl border-2 p-4 text-left transition disabled:opacity-50 ${shareMode === "existing" ? "border-[#ED1C24] bg-red-50" : "border-gray-200 hover:border-red-300"}`}>
                      <span className="block font-black">👥 Select Existing Employee</span>
                      <span className="mt-1 block text-xs text-gray-600">Share with an approved employee</span>
                    </button>
                    <button type="button" disabled={sharingBusy}
                      onClick={() => { setShareMode("invite"); setSharingError(""); setSharingNotice(""); }}
                      className={`rounded-xl border-2 p-4 text-left transition disabled:opacity-50 ${shareMode === "invite" ? "border-[#ED1C24] bg-red-50" : "border-gray-200 hover:border-red-300"}`}>
                      <span className="block font-black">✉️ Send New Invitation</span>
                      <span className="mt-1 block text-xs text-gray-600">Invite someone by email (admin only)</span>
                    </button>
                  </div>
                  {shareMode === "existing" && (
                    <div className="space-y-3 rounded-xl bg-gray-50 p-4">
                      <label htmlFor="share-recipient" className="block text-sm font-bold">Approved employee</label>
                      <select id="share-recipient" value={recipient} onChange={(event) => setRecipient(event.target.value)}
                        className="w-full rounded-xl border border-gray-300 bg-white p-3">
                        <option value="">Select an employee</option>
                        {employees.filter((employee) => !shares.some((share) => share.shared_with === employee.user_id))
                          .map((employee) => <option key={employee.user_id} value={employee.user_id}>{employee.email}</option>)}
                      </select>
                      <label htmlFor="share-permission" className="block text-sm font-bold">Project permission</label>
                      <select id="share-permission" value={permission}
                        onChange={(event) => setPermission(event.target.value as "view" | "edit")}
                        className="w-full rounded-xl border border-gray-300 bg-white p-3">
                        <option value="view">View Only</option>
                        <option value="edit">Can Edit</option>
                      </select>
                      <button type="button" onClick={() => void grantAccess()}
                        disabled={!recipient || sharingBusy}
                        className="rounded-xl bg-[#ED1C24] px-5 py-3 font-black text-white hover:bg-red-700 disabled:opacity-50">
                        {sharingBusy ? "Saving..." : "Grant Access"}
                      </button>
                    </div>
                  )}
                  {shareMode === "invite" && (
                    <form className="space-y-3 rounded-xl bg-gray-50 p-4" onSubmit={(event) => { event.preventDefault(); void sendEmployeeInvitation(); }}>
                      <label htmlFor="invite-email" className="block text-sm font-bold">New employee email address</label>
                      <input id="invite-email" type="email" required maxLength={254}
                        autoComplete="email" value={inviteEmail}
                        onChange={(event) => setInviteEmail(event.target.value)}
                        placeholder="employee@example.com"
                        className="w-full rounded-xl border border-gray-300 bg-white p-3" />
                      <p className="text-xs text-gray-600">Only approved administrators can send invitations. After signup and approval, return to Select Existing Employee to grant access.</p>
                      <button type="submit" disabled={sharingBusy || !inviteEmail.trim()}
                        className="rounded-xl bg-[#ED1C24] px-5 py-3 font-black text-white hover:bg-red-700 disabled:opacity-50">
                        {sharingBusy ? "Sending..." : "Send Invitation"}
                      </button>
                    </form>
                  )}
                </div>
                <div className="mt-7 border-t border-gray-200 pt-5">
                  <h3 className="font-black">Employees with access</h3>
                  {shares.length === 0 ? <p className="mt-3 text-sm text-gray-500">Not shared with anyone yet.</p> : (
                    <div className="mt-3 space-y-3">
                      {shares.map((share) => (
                        <div key={share.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 p-3">
                          <div className="min-w-0 flex-1 text-sm font-semibold break-all">
                            {employees.find((employee) => employee.user_id === share.shared_with)?.email || `Employee ID: ${share.shared_with}`}
                          </div>
                          <select aria-label="Change employee permission" value={share.permission}
                            disabled={sharingBusy}
                            onChange={(event) => void changeAccess(share.id, event.target.value as "view" | "edit")}
                            className="rounded-lg border border-gray-300 p-2 text-sm">
                            <option value="view">View Only</option>
                            <option value="edit">Can Edit</option>
                          </select>
                          <button type="button" disabled={sharingBusy}
                            onClick={() => void removeAccess(share.id)}
                            className="rounded-lg border border-red-200 px-3 py-2 text-sm font-bold text-[#ED1C24] hover:bg-red-50 disabled:opacity-50">
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
            {sharingNotice && <p role="status" className="mt-4 rounded-lg bg-green-50 p-3 text-sm text-green-800">{sharingNotice}</p>}
            {sharingError && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{sharingError}</p>}
          </section>
        </div>
      )}
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
