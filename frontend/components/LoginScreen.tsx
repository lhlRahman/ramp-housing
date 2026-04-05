"use client";

import { useState } from "react";
import { sendOTP, verifyOTP, setAuthToken, getMe } from "@/lib/api";
import { AuthUser } from "@/lib/types";

interface LoginScreenProps {
  onLogin: (user: AuthUser) => void;
}

export default function LoginScreen({ onLogin }: LoginScreenProps) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [step, setStep] = useState<"phone" | "otp" | "name">("phone");
  const [pendingUser, setPendingUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSendOTP = async () => {
    if (!phone.trim()) return;
    setLoading(true);
    setError("");
    try {
      await sendOTP(phone.trim());
      setStep("otp");
    } catch (err: any) {
      setError(err.message || "Failed to send code");
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    if (code.length !== 6) return;
    setLoading(true);
    setError("");
    try {
      const { token, user } = await verifyOTP(phone.trim(), code);
      setAuthToken(token);
      localStorage.setItem("auth_user", JSON.stringify(user));
      if (!user.name) {
        setPendingUser(user);
        setStep("name");
      } else {
        onLogin(user);
      }
    } catch (err: any) {
      setError(err.message || "Invalid code");
    } finally {
      setLoading(false);
    }
  };

  const handleSetName = async () => {
    if (!name.trim() || !pendingUser) return;
    setLoading(true);
    setError("");
    try {
      const resp = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/auth/update-name`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${localStorage.getItem("auth_token")}` },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!resp.ok) throw new Error("Failed to save name");
      const updatedUser = { ...pendingUser, name: name.trim() };
      localStorage.setItem("auth_user", JSON.stringify(updatedUser));
      onLogin(updatedUser);
    } catch (err: any) {
      setError(err.message || "Failed to save name");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface-0 flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-text-primary mb-2">RampHousing</h1>
          <p className="text-text-secondary text-sm">Find your next home, powered by AI</p>
        </div>

        <div className="bg-surface-1 rounded-2xl border border-border p-6 shadow-lg">
          {step === "name" ? (
            <>
              <label className="block text-xs text-text-secondary mb-2 font-medium">What should we call you?</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                className="w-full px-4 py-3 rounded-xl bg-surface-0 border border-border text-text-primary placeholder:text-text-muted focus:outline-none focus:border-ramp-lime/50 text-sm"
                onKeyDown={(e) => e.key === "Enter" && handleSetName()}
                autoFocus
              />
              <button
                onClick={handleSetName}
                disabled={loading || !name.trim()}
                className="w-full mt-4 py-3 rounded-xl bg-ramp-lime text-surface-0 font-semibold text-sm hover:bg-ramp-lime/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? "Saving..." : "Continue"}
              </button>
            </>
          ) : step === "phone" ? (
            <>
              <label className="block text-xs text-text-secondary mb-2 font-medium">Phone number</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 (555) 123-4567"
                className="w-full px-4 py-3 rounded-xl bg-surface-0 border border-border text-text-primary placeholder:text-text-muted focus:outline-none focus:border-ramp-lime/50 text-sm"
                onKeyDown={(e) => e.key === "Enter" && handleSendOTP()}
                autoFocus
              />
              <button
                onClick={handleSendOTP}
                disabled={loading || !phone.trim()}
                className="w-full mt-4 py-3 rounded-xl bg-ramp-lime text-surface-0 font-semibold text-sm hover:bg-ramp-lime/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? "Sending..." : "Send verification code"}
              </button>
            </>
          ) : (
            <>
              <p className="text-xs text-text-secondary mb-3">
                Enter the 6-digit code sent to <span className="text-text-primary font-medium">{phone}</span>
              </p>
              <input
                type="text"
                inputMode="numeric"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                className="w-full px-4 py-3 rounded-xl bg-surface-0 border border-border text-text-primary placeholder:text-text-muted focus:outline-none focus:border-ramp-lime/50 text-sm text-center tracking-[0.3em] font-mono text-lg"
                onKeyDown={(e) => e.key === "Enter" && handleVerify()}
                autoFocus
              />
              <button
                onClick={handleVerify}
                disabled={loading || code.length !== 6}
                className="w-full mt-4 py-3 rounded-xl bg-ramp-lime text-surface-0 font-semibold text-sm hover:bg-ramp-lime/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? "Verifying..." : "Verify & sign in"}
              </button>
              <button
                onClick={() => { setStep("phone"); setCode(""); setError(""); }}
                className="w-full mt-2 py-2 text-xs text-text-secondary hover:text-text-primary transition-colors"
              >
                Use a different number
              </button>
            </>
          )}

          {error && (
            <p className="mt-3 text-xs text-red-400 text-center">{error}</p>
          )}
        </div>

        <p className="text-center text-xs text-text-muted mt-4">
          By signing in, a new account is created automatically.
        </p>
      </div>
    </div>
  );
}
