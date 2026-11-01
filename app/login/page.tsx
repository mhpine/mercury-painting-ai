
"use client";

import { useState, type CSSProperties, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabase";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });

        if (error) throw error;

        if (data.session) {
          setMessage("Account created successfully.");
          router.push("/");
          router.refresh();
        } else {
          setMessage(
            "Check your email for a confirmation link before signing in."
          );
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

        if (error) throw error;

        router.push("/");
        router.refresh();
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Something went wrong. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.page}>
     

      {/* MAIN CONTENT */}
      <main style={styles.main}>
        <div style={styles.intro}>
          <span style={styles.eyebrow}>
            MERCURY PAINTING COMPANY
          </span>

          <h1 style={styles.heading}>
            EMPLOYEE <span style={styles.redText}>PORTAL</span>
          </h1>

          <p style={styles.subtitle}>
            Access your painting projects, walkthroughs, and estimates
            from your computer or phone.
          </p>
        </div>

        <div style={styles.loginCard}>
          <div style={styles.cardAccent} />

          <div style={styles.cardBody}>
            

            <h2 style={styles.cardTitle}>
              {mode === "login"
                ? "Employee Sign In"
                : "Create Employee Account"}
            </h2>

            <p style={styles.cardDescription}>
              {mode === "login"
                ? "Sign in to access the Mercury Painting AI Estimator."
                : "Enter your information to create an account."}
            </p>

            <form onSubmit={handleSubmit}>
              <label htmlFor="email" style={styles.label}>
                Email Address
              </label>

              <input
                id="email"
                type="email"
                placeholder="you@mercurypainting.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                style={styles.input}
              />

              <label htmlFor="password" style={styles.label}>
                Password
              </label>

              <div style={styles.passwordWrapper}>
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={
                    mode === "login"
                      ? "current-password"
                      : "new-password"
                  }
                  minLength={6}
                  required
                  style={styles.passwordInput}
                />

                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={styles.showPassword}
                  aria-label={
                    showPassword ? "Hide password" : "Show password"
                  }
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>

              <button
                type="submit"
                disabled={loading}
                style={{
                  ...styles.submitButton,
                  opacity: loading ? 0.65 : 1,
                }}
              >
                {loading
                  ? "Please wait..."
                  : mode === "login"
                  ? "SIGN IN"
                  : "CREATE ACCOUNT"}
              </button>
            </form>

            {message && (
              <div role="status" style={styles.message}>
                {message}
              </div>
            )}

            <div style={styles.switchSection}>
              <span style={styles.switchText}>
                {mode === "login"
                  ? "Need an employee account?"
                  : "Already have an account?"}
              </span>

              <button
                type="button"
                onClick={() => {
                  setMode(mode === "login" ? "signup" : "login");
                  setMessage("");
                }}
                style={styles.switchButton}
              >
                {mode === "login"
                  ? "Create Employee Account"
                  : "Sign In Instead"}
              </button>
            </div>
          </div>
        </div>

        <p style={styles.securityNote}>
          Employee access • Secure authentication powered by Supabase
        </p>
      </main>

      {/* FOOTER */}
      <footer style={styles.footer}>
        <div style={styles.footerInner}>
          <div style={styles.footerBrand}>
            <img
              src="/images/mercury-logo.png"
              alt="Mercury Painting"
              style={styles.footerLogo}
            />
            <span style={styles.footerDivider} />
            <span style={styles.footerTitle}>AI ESTIMATOR</span>
          </div>

          <p style={styles.footerText}>
  © 2026 Mercury Painting Company
</p>

          <p style={styles.footerCredit}>
            Powered by{" "}
            <strong style={{ color: "#FFD400" }}>ECI</strong>
            {" "}— Emerald Coast Innovations
          </p>
        </div>
      </footer>

      <style jsx global>{`
        * {
          box-sizing: border-box;
        }

        .mercury-mobile-menu-button {
          display: none !important;
        }

        @media (max-width: 850px) {
          .mercury-desktop-nav {
            display: none !important;
          }

          .mercury-mobile-menu-button {
            display: block !important;
          }
        }

        @media (max-width: 480px) {
          .mercury-login-brand-title {
            font-size: 13px;
          }
        }
      `}</style>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#ffffff",
    color: "#171717",
    display: "flex",
    flexDirection: "column",
    fontFamily: "Arial, Helvetica, sans-serif",
  },

  header: {
    background: "#ffffff",
    borderBottom: "1px solid #eeeeee",
    position: "relative",
    zIndex: 10,
  },

  headerInner: {
    maxWidth: "1300px",
    margin: "0 auto",
    padding: "18px 24px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "20px",
  },

  brand: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    textDecoration: "none",
    minWidth: 0,
  },

  logo: {
    width: "145px",
    height: "auto",
    objectFit: "contain",
  },

  brandDivider: {
    width: "3px",
    height: "30px",
    background: "#FFD400",
    flexShrink: 0,
  },

  brandTitle: {
    color: "#ED1C24",
    fontWeight: 900,
    fontSize: "17px",
    whiteSpace: "nowrap",
  },

  desktopNav: {
    display: "flex",
    alignItems: "center",
    gap: "22px",
  },

  navLink: {
    color: "#252525",
    fontSize: "14px",
    fontWeight: 700,
    textDecoration: "none",
  },

  newProjectButton: {
    background: "#ED1C24",
    color: "#ffffff",
    textDecoration: "none",
    padding: "12px 17px",
    borderRadius: "8px",
    fontWeight: 800,
    fontSize: "13px",
    whiteSpace: "nowrap",
  },

  menuButton: {
    background: "#ffffff",
    border: "1px solid #dddddd",
    borderRadius: "8px",
    padding: "8px 13px",
    fontSize: "23px",
    cursor: "pointer",
    color: "#222222",
  },

  mobileNav: {
    display: "flex",
    flexDirection: "column",
    gap: "3px",
    padding: "10px 24px 20px",
    background: "#ffffff",
    borderTop: "1px solid #eeeeee",
  },

  mobileLink: {
    color: "#222222",
    textDecoration: "none",
    fontWeight: 700,
    padding: "12px 4px",
  },

  mobileNewProject: {
    background: "#ED1C24",
    color: "#ffffff",
    textDecoration: "none",
    padding: "13px",
    borderRadius: "8px",
    textAlign: "center",
    fontWeight: 800,
    marginTop: "8px",
  },

  main: {
    width: "100%",
    flex: 1,
    padding: "65px 20px 80px",
    background:
      "linear-gradient(180deg, #ffffff 0%, #f8f8f8 100%)",
  },

  intro: {
    maxWidth: "650px",
    margin: "0 auto 35px",
    textAlign: "center",
  },

  eyebrow: {
    color: "#ED1C24",
    fontSize: "12px",
    fontWeight: 900,
    letterSpacing: "2px",
  },

  heading: {
    fontSize: "clamp(30px, 5vw, 46px)",
    fontWeight: 900,
    margin: "13px 0",
    letterSpacing: "-1px",
  },

  redText: {
    color: "#ED1C24",
  },

  subtitle: {
    color: "#666666",
    fontSize: "16px",
    lineHeight: 1.7,
    margin: 0,
  },

  loginCard: {
    maxWidth: "470px",
    margin: "0 auto",
    background: "#ffffff",
    borderRadius: "16px",
    overflow: "hidden",
    boxShadow: "0 12px 40px rgba(0,0,0,0.09)",
    border: "1px solid #e9e9e9",
  },

  cardAccent: {
    height: "6px",
    background: "#ED1C24",
  },

  cardBody: {
    padding: "35px 28px",
  },

  cardIcon: {
    width: "48px",
    height: "48px",
    background: "#fff1f1",
    color: "#ED1C24",
    borderRadius: "12px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 900,
    fontSize: "17px",
    marginBottom: "20px",
  },

  cardTitle: {
    fontSize: "25px",
    fontWeight: 900,
    margin: "0 0 10px",
    color: "#171717",
  },

  cardDescription: {
    color: "#777777",
    fontSize: "14px",
    lineHeight: 1.6,
    marginBottom: "26px",
  },

  label: {
    display: "block",
    color: "#333333",
    fontSize: "13px",
    fontWeight: 800,
    marginBottom: "8px",
  },

  input: {
    width: "100%",
    padding: "14px",
    background: "#ffffff",
    border: "1px solid #d6d6d6",
    borderRadius: "8px",
    color: "#171717",
    fontSize: "15px",
    marginBottom: "20px",
    outlineColor: "#ED1C24",
  },

  passwordWrapper: {
    position: "relative",
    marginBottom: "24px",
  },

  passwordInput: {
    width: "100%",
    padding: "14px 65px 14px 14px",
    background: "#ffffff",
    border: "1px solid #d6d6d6",
    borderRadius: "8px",
    color: "#171717",
    fontSize: "15px",
    outlineColor: "#ED1C24",
  },

  showPassword: {
    position: "absolute",
    right: "12px",
    top: "50%",
    transform: "translateY(-50%)",
    border: "none",
    background: "transparent",
    color: "#ED1C24",
    fontWeight: 800,
    cursor: "pointer",
  },

  submitButton: {
    width: "100%",
    padding: "15px",
    background: "#ED1C24",
    color: "#ffffff",
    border: "none",
    borderRadius: "8px",
    fontWeight: 900,
    fontSize: "15px",
    cursor: "pointer",
  },

  message: {
    marginTop: "18px",
    padding: "13px",
    background: "#fff8e0",
    border: "1px solid #f4df9d",
    borderRadius: "8px",
    color: "#654d00",
    fontSize: "13px",
    lineHeight: 1.5,
  },

  switchSection: {
    marginTop: "25px",
    paddingTop: "22px",
    borderTop: "1px solid #eeeeee",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "10px",
  },

  switchText: {
    color: "#777777",
    fontSize: "13px",
  },

  switchButton: {
    background: "transparent",
    border: "none",
    color: "#ED1C24",
    fontWeight: 800,
    fontSize: "14px",
    cursor: "pointer",
    textDecoration: "underline",
  },

  securityNote: {
    color: "#888888",
    fontSize: "12px",
    textAlign: "center",
    marginTop: "25px",
  },

  footer: {
    background: "#151515",
    color: "#ffffff",
    padding: "35px 20px",
  },

  footerInner: {
    maxWidth: "1300px",
    margin: "0 auto",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "13px",
    textAlign: "center",
  },

  footerBrand: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
  },

  footerLogo: {
    width: "125px",
    height: "auto",
    objectFit: "contain",
    background: "#ffffff",
    padding: "5px",
    borderRadius: "4px",
  },

  footerDivider: {
    width: "3px",
    height: "25px",
    background: "#FFD400",
  },

  footerTitle: {
    color: "#ED1C24",
    fontWeight: 900,
    fontSize: "15px",
  },

  footerText: {
    color: "#aaaaaa",
    fontSize: "12px",
    margin: 0,
  },

  footerCredit: {
    color: "#cccccc",
    fontSize: "12px",
    margin: 0,
  },
};
