"use client";
import { useState } from "react";
import { RenterProfile } from "@/lib/types";
import { upsertRenterProfile } from "@/lib/api";

interface Props {
  existingProfile: RenterProfile | null;
  defaultPhone?: string;
  onSaved: (profile: RenterProfile) => void;
  onClose: () => void;
}

export default function RenterProfileModal({ existingProfile, defaultPhone, onSaved, onClose }: Props) {
  const [phone, setPhone] = useState(existingProfile?.phone || defaultPhone || "");
  const [name, setName] = useState(existingProfile?.name || "");
  const [currentCity, setCurrentCity] = useState(existingProfile?.current_city || "");
  const [moveInDate, setMoveInDate] = useState(existingProfile?.move_in_date || "");
  const [budgetMax, setBudgetMax] = useState(existingProfile?.budget_max?.toString() || "");
  const [incomeRange, setIncomeRange] = useState(existingProfile?.income_range || "");
  const [creditScoreRange, setCreditScoreRange] = useState(existingProfile?.credit_score_range || "");
  const [pets, setPets] = useState(existingProfile?.pets || "");
  const [smoker, setSmoker] = useState(existingProfile?.smoker || false);
  const [guarantor, setGuarantor] = useState(existingProfile?.guarantor || false);
  const [dealbreakers, setDealbreakers] = useState(existingProfile?.dealbreakers || "");
  const [freeText, setFreeText] = useState(existingProfile?.free_text_context || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!phone.trim()) { setError("Phone number is required"); return; }
    const cleaned = phone.trim().replace(/[\s\-()]/g, "");
    if (!/^\+?1?\d{10,15}$/.test(cleaned)) { setError("Invalid phone number format"); return; }
    setSaving(true);
    setError("");
    try {
      const profile = await upsertRenterProfile({
        phone: phone.trim(),
        name: name || null,
        current_city: currentCity || null,
        move_in_date: moveInDate || null,
        budget_max: budgetMax ? parseInt(budgetMax) : null,
        income_range: incomeRange || null,
        credit_score_range: creditScoreRange || null,
        pets: pets || null,
        smoker,
        guarantor,
        dealbreakers: dealbreakers || null,
        free_text_context: freeText || null,
      });
      onSaved(profile);
    } catch (err: any) {
      setError(err.message || "Failed to save profile");
    } finally {
      setSaving(false);
    }
  };

  const inputCls = "w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-ramp-lime/50 focus:ring-1 focus:ring-ramp-lime/20";
  const labelCls = "block text-xs font-medium text-text-secondary mb-1";

  return (
    <>
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[2000]" onClick={onClose} />
      <div className="fixed inset-0 z-[2001] flex items-center justify-center p-6 pointer-events-none">
        <div className="bg-surface-1 rounded-2xl shadow-2xl border border-border w-full max-w-[520px] max-h-[85vh] flex flex-col overflow-hidden pointer-events-auto">
          <div className="px-6 py-4 border-b border-border flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-text-primary">Your Profile</h2>
              <p className="text-xs text-text-muted mt-0.5">Help the agent represent you to landlords</p>
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-full bg-surface-3 hover:bg-surface-4 text-text-muted hover:text-text-primary flex items-center justify-center transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Phone *</label>
                <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+1234567890" className={inputCls} required disabled={!!existingProfile || !!defaultPhone} />
              </div>
              <div>
                <label className={labelCls}>Name</label>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" className={inputCls} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Current City</label>
                <input value={currentCity} onChange={e => setCurrentCity(e.target.value)} placeholder="New York, NY" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Move-in Date</label>
                <input type="date" value={moveInDate} onChange={e => setMoveInDate(e.target.value)} className={inputCls} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Budget Max ($/mo)</label>
                <input type="number" value={budgetMax} onChange={e => setBudgetMax(e.target.value)} placeholder="3000" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Income Range</label>
                <input value={incomeRange} onChange={e => setIncomeRange(e.target.value)} placeholder="$80k-100k" className={inputCls} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Credit Score Range</label>
                <input value={creditScoreRange} onChange={e => setCreditScoreRange(e.target.value)} placeholder="700-750" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Pets</label>
                <input value={pets} onChange={e => setPets(e.target.value)} placeholder="1 cat, no dogs" className={inputCls} />
              </div>
            </div>

            <div className="flex gap-6">
              <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
                <input type="checkbox" checked={smoker} onChange={e => setSmoker(e.target.checked)} className="rounded border-border bg-surface-2 text-ramp-lime focus:ring-ramp-lime/20" />
                Smoker
              </label>
              <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
                <input type="checkbox" checked={guarantor} onChange={e => setGuarantor(e.target.checked)} className="rounded border-border bg-surface-2 text-ramp-lime focus:ring-ramp-lime/20" />
                Has Guarantor
              </label>
            </div>

            <div>
              <label className={labelCls}>Dealbreakers</label>
              <input value={dealbreakers} onChange={e => setDealbreakers(e.target.value)} placeholder="No basement, must have in-unit laundry" className={inputCls} />
            </div>

            <div>
              <label className={labelCls}>Anything else the landlord should know</label>
              <textarea value={freeText} onChange={e => setFreeText(e.target.value)} placeholder="I work from home, need a quiet building..." rows={3} className={inputCls + " resize-none"} />
            </div>

            {error && <p className="text-xs text-red-400">{error}</p>}
          </form>

          <div className="px-6 py-4 border-t border-border flex justify-end gap-3">
            <button onClick={onClose} className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors">Cancel</button>
            <button onClick={() => handleSubmit()} disabled={saving} className="btn-ramp px-6 py-2 text-sm disabled:opacity-50">
              {saving ? "Saving..." : "Save Profile"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
