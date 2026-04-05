"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { sendOTP, verifyOTP, setAuthToken } from "@/lib/api";
import { AuthUser } from "@/lib/types";

interface LoginScreenProps {
  onLogin: (user: AuthUser) => void;
}

const spring = { type: "spring" as const, stiffness: 300, damping: 30 };
const fadeSlide = {
  initial: { opacity: 0, y: 20, filter: "blur(4px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  exit: { opacity: 0, y: -20, filter: "blur(4px)" },
  transition: { ...spring, duration: 0.4 },
};

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

  const stepIndex = step === "phone" ? 0 : step === "otp" ? 1 : 2;

  return (
    <div className="min-h-screen bg-surface-0 flex items-center justify-center p-6 relative overflow-hidden">
      {/* Subtle gradient orb */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full opacity-[0.03] pointer-events-none"
        style={{ background: "radial-gradient(circle, #EBF123 0%, transparent 70%)" }}
      />

      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-sm relative z-10"
      >
        {/* Logo + heading */}
        <motion.div
          className="text-center mb-8"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.5 }}
        >
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-ramp-lime/10 mb-4">
            <img src="/logo.svg" alt="RampHousing" className="w-10 h-10 rounded-xl" />
          </div>
          <h1 className="text-2xl font-bold text-text-primary tracking-tight">RampHousing</h1>
          <p className="text-text-muted text-sm mt-1">Find your next home, powered by AI</p>
        </motion.div>

        {/* Progress dots */}
        <div className="flex items-center justify-center gap-2 mb-6">
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              className="h-1 rounded-full"
              animate={{
                width: i === stepIndex ? 24 : 8,
                backgroundColor: i <= stepIndex ? "#EBF123" : "#2A2A2A",
              }}
              transition={spring}
            />
          ))}
        </div>

        {/* Card */}
        <div className="bg-surface-1 rounded-2xl border border-border-light p-6 shadow-lg relative overflow-hidden">
          <AnimatePresence mode="wait">
            {step === "name" && (
              <motion.div key="name" {...fadeSlide}>
                <label className="block text-xs text-text-muted mb-1.5 font-medium uppercase tracking-wider">Your name</label>
                <p className="text-sm text-text-secondary mb-4">How should landlords address you?</p>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter your name"
                  className="w-full px-4 py-3 rounded-xl bg-surface-0 border border-border text-text-primary placeholder:text-text-muted focus:outline-none focus:border-ramp-lime/50 focus:ring-1 focus:ring-ramp-lime/20 text-sm transition-all"
                  onKeyDown={(e) => e.key === "Enter" && handleSetName()}
                  autoFocus
                />
                <motion.button
                  onClick={handleSetName}
                  disabled={loading || !name.trim()}
                  className="w-full mt-4 py-3 rounded-xl bg-ramp-lime text-surface-0 font-semibold text-sm disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.98 }}
                >
                  {loading ? <LoadingDots /> : "Get started"}
                </motion.button>
              </motion.div>
            )}

            {step === "phone" && (
              <motion.div key="phone" {...fadeSlide}>
                <label className="block text-xs text-text-muted mb-1.5 font-medium uppercase tracking-wider">Phone number</label>
                <p className="text-sm text-text-secondary mb-4">We&apos;ll send you a verification code</p>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 (555) 123-4567"
                  className="w-full px-4 py-3 rounded-xl bg-surface-0 border border-border text-text-primary placeholder:text-text-muted focus:outline-none focus:border-ramp-lime/50 focus:ring-1 focus:ring-ramp-lime/20 text-sm transition-all"
                  onKeyDown={(e) => e.key === "Enter" && handleSendOTP()}
                  autoFocus
                />
                <motion.button
                  onClick={handleSendOTP}
                  disabled={loading || !phone.trim()}
                  className="w-full mt-4 py-3 rounded-xl bg-ramp-lime text-surface-0 font-semibold text-sm disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.98 }}
                >
                  {loading ? <LoadingDots /> : "Continue"}
                </motion.button>
              </motion.div>
            )}

            {step === "otp" && (
              <motion.div key="otp" {...fadeSlide}>
                <label className="block text-xs text-text-muted mb-1.5 font-medium uppercase tracking-wider">Verification code</label>
                <p className="text-sm text-text-secondary mb-4">
                  Sent to <span className="text-text-primary font-medium">{phone}</span>
                </p>
                <input
                  type="text"
                  inputMode="numeric"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="------"
                  className="w-full px-4 py-3 rounded-xl bg-surface-0 border border-border text-text-primary placeholder:text-text-muted focus:outline-none focus:border-ramp-lime/50 focus:ring-1 focus:ring-ramp-lime/20 text-sm text-center tracking-[0.4em] font-mono text-lg transition-all"
                  onKeyDown={(e) => e.key === "Enter" && handleVerify()}
                  autoFocus
                />
                <motion.button
                  onClick={handleVerify}
                  disabled={loading || code.length !== 6}
                  className="w-full mt-4 py-3 rounded-xl bg-ramp-lime text-surface-0 font-semibold text-sm disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.98 }}
                >
                  {loading ? <LoadingDots /> : "Verify"}
                </motion.button>
                <button
                  onClick={() => { setStep("phone"); setCode(""); setError(""); }}
                  className="w-full mt-2 py-2 text-xs text-text-muted hover:text-text-secondary transition-colors"
                >
                  Use a different number
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {error && (
              <motion.p
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="text-xs text-red-400 text-center mt-3"
              >
                {error}
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="text-center text-xs text-text-muted mt-4"
        >
          New accounts are created automatically
        </motion.p>
      </motion.div>
    </div>
  );
}

function LoadingDots() {
  return (
    <span className="inline-flex items-center gap-1">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-surface-0"
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.15 }}
        />
      ))}
    </span>
  );
}
