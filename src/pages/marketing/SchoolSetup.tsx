// SchoolSetup — a guided wizard for school directors to request setup.
//
// Instead of dumping the user on the generic /contact page, this page walks
// them through a multi-step form:
//   Step 1: School info (name, location, contact)
//   Step 2: Class details (how many classes, grade levels, streams)
//   Step 3: Seat estimate (how many students → which pricing tier)
//   Step 4: Review + submit → creates a contact message + notifies admin
//
// On submit, it reuses the existing contactMessages system (same backend
// that /contact uses) but with a pre-filled category + structured body so
// the admin immediately sees it's a school setup request with all the
// details. The admin then creates the school in /admin → Schools and
// designates the director.
//
// Gated on SCHOOL_FEATURE_ENABLED at the route level (SchoolFeatureGate).

import { api } from "@/convex/_generated/api";
import { useAction, useQuery } from "convex/react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  GraduationCap,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Send,
  Sparkles,
  Users,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { MarketingLayout } from "@/components/MarketingLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useFriendlyError } from "@/lib/errors";
import { cn } from "@/lib/utils";

type Step = 1 | 2 | 3 | 4;

export default function SchoolSetup() {
  const friendlyError = useFriendlyError();
  const navigate = useNavigate();
  const pricing = useQuery(api.configKeys.getSchoolSeatPricing);
  const sendContactMessage = useAction(api.telegramActions.sendContactMessage);

  const [step, setStep] = useState<Step>(1);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Step 1 — School info
  const [schoolName, setSchoolName] = useState("");
  const [location, setLocation] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");

  // Step 2 — Class details
  const [classCount, setClassCount] = useState("1");
  const [grades, setGrades] = useState<string[]>([]);
  const [streams, setStreams] = useState<string[]>([]);

  // Step 3 — Seat estimate
  const [studentCount, setStudentCount] = useState("30");
  const [durationMonths, setDurationMonths] = useState("3");
  const [notes, setNotes] = useState("");

  // Calculate pricing
  const seats = parseInt(studentCount, 10) || 0;
  const months = parseInt(durationMonths, 10) || 1;
  const tierUsed = seats >= 100 ? 4 : seats >= 50 ? 3 : seats >= 20 ? 2 : 1;
  const tierRate = pricing
    ? tierUsed === 4 ? pricing.tier4 : tierUsed === 3 ? pricing.tier3 : tierUsed === 2 ? pricing.tier2 : pricing.tier1
    : 0;
  const total = tierRate * seats * months;
  const tierLabel = ["", "1–19 seats", "20–49 seats", "50–99 seats", "100+ seats"][tierUsed];

  const canProceed = () => {
    if (step === 1) return schoolName.trim() && contactEmail.trim();
    if (step === 2) return grades.length > 0 && streams.length > 0;
    if (step === 3) return seats > 0 && months > 0;
    return true;
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const body = [
        `SCHOOL SETUP REQUEST`,
        ``,
        `School: ${schoolName.trim()}`,
        `Location: ${location.trim() || "Not specified"}`,
        `Contact: ${contactEmail.trim()}${contactPhone.trim() ? ` / ${contactPhone.trim()}` : ""}`,
        ``,
        `Classes: ${classCount}`,
        `Grades: ${grades.join(", ") || "Not specified"}`,
        `Streams: ${streams.join(", ") || "Not specified"}`,
        ``,
        `Estimated students: ${seats}`,
        `Duration: ${months} month${months === 1 ? "" : "s"}`,
        `Pricing tier: ${tierUsed} (${tierLabel}) — ${tierRate} ETB/seat/mo`,
        `Estimated total: ${total.toLocaleString()} ETB`,
        ``,
        `Notes:`,
        notes.trim() || "(none)",
      ].join("\n");

      await sendContactMessage({
        name: schoolName.trim(),
        email: contactEmail.trim(),
        category: "school_setup",
        message: body,
      });
      setSubmitted(true);
      toast.success("Setup request sent! We'll review and get back to you within 24 hours.");
    } catch (e) {
      toast.error(friendlyError(e, "Could not submit the request."));
    } finally {
      setSubmitting(false);
    }
  };

  // ── Success state ─────────────────────────────────────────────────
  if (submitted) {
    return (
      <MarketingLayout eyebrow="School Setup" eyebrowColor="violet" title="School Setup">
        <div className="mx-auto max-w-lg px-4 py-20 text-center">
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 200, damping: 18 }}
            className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-emerald-400/15 text-emerald-300 shadow-[0_0_40px_-8px_rgb(16,185,129/0.5)]"
          >
            <CheckCircle2 className="size-8" />
          </motion.div>
          <h1 className="mt-6 type-h2 text-gradient">Request sent! 🎉</h1>
          <p className="mt-3 type-body text-muted-foreground">
            We've received your school setup request for <span className="font-bold text-foreground">{schoolName}</span>.
            Our team will review it and get back to you at <span className="font-bold text-foreground">{contactEmail}</span> within 24 hours.
          </p>
          <p className="mt-4 type-body text-muted-foreground">
            Once approved, you'll get a dedicated director dashboard where you can create
            classes, share join codes with your students, and manage bulk premium seats.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg" className="rounded-xl">
              <Link to="/for-schools">Back to Schools</Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="rounded-xl bg-white/5">
              <Link to="/">Back to home</Link>
            </Button>
          </div>
        </div>
      </MarketingLayout>
    );
  }

  return (
    <MarketingLayout eyebrow="School Setup" eyebrowColor="violet" title="School Setup">
      <div className="mx-auto max-w-2xl px-4 py-12 sm:py-16">
        {/* Progress bar */}
        <div className="mb-8 flex items-center gap-2">
          {[1, 2, 3, 4].map((s) => (
            <div
              key={s}
              className={cn(
                "h-1.5 flex-1 rounded-full transition-all duration-300",
                s <= step ? "bg-violet-400" : "bg-white/10",
              )}
            />
          ))}
        </div>
        <p className="mb-6 text-center font-mono text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Step {step} of 4
        </p>

        <AnimatePresence mode="wait">
          {/* ══ STEP 1: School info ══ */}
          {step === 1 && (
            <motion.div
              key="step1"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="flex flex-col gap-5"
            >
              <div className="text-center">
                <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-violet-400/15 text-violet-300">
                  <Building2 className="size-6" />
                </div>
                <h2 className="mt-3 type-h2">Tell us about your school</h2>
                <p className="mt-1 type-body text-muted-foreground">
                  We'll set up your school on the platform and designate you as the director.
                </p>
              </div>
              <div className="glass-panel rounded-2xl p-5 flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-muted-foreground">School name *</label>
                  <Input
                    value={schoolName}
                    onChange={(e) => setSchoolName(e.target.value)}
                    placeholder="e.g. Addis Ababa Science High School"
                    className="h-11 rounded-xl bg-white/5"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-muted-foreground">
                    <MapPin className="inline size-3" /> Location (city / region)
                  </label>
                  <Input
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="e.g. Addis Ababa"
                    className="h-11 rounded-xl bg-white/5"
                  />
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-muted-foreground">
                      <Mail className="inline size-3" /> Email *
                    </label>
                    <Input
                      type="email"
                      value={contactEmail}
                      onChange={(e) => setContactEmail(e.target.value)}
                      placeholder="director@school.edu"
                      className="h-11 rounded-xl bg-white/5"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-muted-foreground">
                      <Phone className="inline size-3" /> Phone
                    </label>
                    <Input
                      value={contactPhone}
                      onChange={(e) => setContactPhone(e.target.value)}
                      placeholder="+251 9..."
                      className="h-11 rounded-xl bg-white/5"
                    />
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* ══ STEP 2: Class details ══ */}
          {step === 2 && (
            <motion.div
              key="step2"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="flex flex-col gap-5"
            >
              <div className="text-center">
                <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-violet-400/15 text-violet-300">
                  <GraduationCap className="size-6" />
                </div>
                <h2 className="mt-3 type-h2">Class details</h2>
                <p className="mt-1 type-body text-muted-foreground">
                  How many classes do you want to set up? Pick the grades and streams.
                </p>
              </div>
              <div className="glass-panel rounded-2xl p-5 flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-muted-foreground">How many classes?</label>
                  <Select value={classCount} onValueChange={setClassCount}>
                    <SelectTrigger className="h-11 rounded-xl bg-white/5">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {["1", "2", "3", "4", "5", "6+"].map((n) => (
                        <SelectItem key={n} value={n}>{n} class{n === "1" ? "" : "es"}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-muted-foreground">Grade levels</label>
                  <div className="flex flex-wrap gap-2">
                    {["Grade 9", "Grade 10", "Grade 11", "Grade 12"].map((g) => {
                      const active = grades.includes(g);
                      return (
                        <button
                          key={g}
                          type="button"
                          onClick={() => setGrades(active ? grades.filter((x) => x !== g) : [...grades, g])}
                          className={cn(
                            "interactive-press cursor-pointer rounded-xl border px-4 py-2 text-sm font-semibold transition",
                            active
                              ? "border-violet-400/40 bg-violet-400/15 text-violet-300"
                              : "border-white/10 bg-white/[0.04] text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {active && <Check className="mr-1 inline size-3" />}
                          {g}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-muted-foreground">Streams</label>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { id: "natural", label: "Natural Science" },
                      { id: "social", label: "Social Science" },
                      { id: "common", label: "Common (Grades 9–10)" },
                    ].map((s) => {
                      const active = streams.includes(s.id);
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => setStreams(active ? streams.filter((x) => x !== s.id) : [...streams, s.id])}
                          className={cn(
                            "interactive-press cursor-pointer rounded-xl border px-4 py-2 text-sm font-semibold transition",
                            active
                              ? "border-violet-400/40 bg-violet-400/15 text-violet-300"
                              : "border-white/10 bg-white/[0.04] text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {active && <Check className="mr-1 inline size-3" />}
                          {s.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* ══ STEP 3: Seat estimate ══ */}
          {step === 3 && (
            <motion.div
              key="step3"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="flex flex-col gap-5"
            >
              <div className="text-center">
                <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-violet-400/15 text-violet-300">
                  <Users className="size-6" />
                </div>
                <h2 className="mt-3 type-h2">Seat estimate</h2>
                <p className="mt-1 type-body text-muted-foreground">
                  How many students need premium access? This determines your pricing tier.
                </p>
              </div>
              <div className="glass-panel rounded-2xl p-5 flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-muted-foreground">Students (seats)</label>
                    <Input
                      type="number"
                      min={1}
                      max={1000}
                      value={studentCount}
                      onChange={(e) => setStudentCount(e.target.value)}
                      className="h-11 rounded-xl bg-white/5"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-muted-foreground">Duration (months)</label>
                    <Select value={durationMonths} onValueChange={setDurationMonths}>
                      <SelectTrigger className="h-11 rounded-xl bg-white/5">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[1, 3, 6, 12].map((m) => (
                          <SelectItem key={m} value={String(m)}>{m} month{m === 1 ? "" : "s"}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Live pricing summary */}
                <div className="rounded-2xl border border-violet-400/20 bg-violet-400/[0.05] p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted-foreground">Pricing tier</span>
                    <Badge className="border-violet-400/30 bg-violet-400/10 text-violet-300">
                      Tier {tierUsed}: {tierLabel}
                    </Badge>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted-foreground">Per-seat / month</span>
                    <span className="font-mono text-sm text-foreground">{tierRate} ETB</span>
                  </div>
                  <div className="mt-3 border-t border-white/10 pt-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-foreground">Estimated total</span>
                      <span className="font-mono text-2xl font-extrabold text-violet-200">
                        {total.toLocaleString()} <span className="text-sm text-muted-foreground">ETB</span>
                      </span>
                    </div>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                      {seats} seats × {months} month{months === 1 ? "" : "s"} × {tierRate} ETB
                    </p>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-muted-foreground">Additional notes (optional)</label>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Anything else we should know about your school's needs?"
                    rows={3}
                    className="rounded-xl bg-white/5"
                  />
                </div>
              </div>
            </motion.div>
          )}

          {/* ══ STEP 4: Review ══ */}
          {step === 4 && (
            <motion.div
              key="step4"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="flex flex-col gap-5"
            >
              <div className="text-center">
                <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-violet-400/15 text-violet-300">
                  <Sparkles className="size-6" />
                </div>
                <h2 className="mt-3 type-h2">Review your request</h2>
                <p className="mt-1 type-body text-muted-foreground">
                  Check everything looks right, then submit. We'll get back to you within 24 hours.
                </p>
              </div>
              <div className="glass-panel rounded-2xl p-5 flex flex-col gap-3">
                <ReviewRow label="School" value={schoolName} />
                <ReviewRow label="Location" value={location || "Not specified"} />
                <ReviewRow label="Contact" value={`${contactEmail}${contactPhone ? ` / ${contactPhone}` : ""}`} />
                <div className="h-px bg-white/10" />
                <ReviewRow label="Classes" value={classCount} />
                <ReviewRow label="Grades" value={grades.join(", ") || "Not specified"} />
                <ReviewRow label="Streams" value={streams.join(", ") || "Not specified"} />
                <div className="h-px bg-white/10" />
                <ReviewRow label="Students" value={`${seats} seats`} />
                <ReviewRow label="Duration" value={`${months} month${months === 1 ? "" : "s"}`} />
                <ReviewRow label="Tier" value={`Tier ${tierUsed} (${tierLabel}) — ${tierRate} ETB/seat/mo`} />
                <div className="mt-2 rounded-xl border border-violet-400/20 bg-violet-400/[0.05] p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-foreground">Estimated total</span>
                    <span className="font-mono text-xl font-extrabold text-violet-200">
                      {total.toLocaleString()} ETB
                    </span>
                  </div>
                </div>
                {notes.trim() && (
                  <>
                    <div className="h-px bg-white/10" />
                    <ReviewRow label="Notes" value={notes} />
                  </>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Navigation */}
        <div className="mt-8 flex items-center justify-between gap-3">
          <Button
            variant="ghost"
            className="cursor-pointer rounded-xl text-muted-foreground"
            onClick={() => (step === 1 ? navigate("/for-schools") : setStep((step - 1) as Step))}
            disabled={submitting}
          >
            <ArrowLeft className="size-4" /> {step === 1 ? "Back" : "Previous"}
          </Button>
          {step < 4 ? (
            <Button
              className="cursor-pointer rounded-xl"
              onClick={() => setStep((step + 1) as Step)}
              disabled={!canProceed()}
            >
              Continue <ArrowRight className="size-4" />
            </Button>
          ) : (
            <Button
              className="cursor-pointer rounded-xl"
              onClick={() => void handleSubmit()}
              disabled={submitting}
            >
              {submitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <>
                  <Send className="size-4" /> Submit request
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </MarketingLayout>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-xs font-semibold text-muted-foreground">{label}</span>
      <span className="text-right text-sm text-foreground/90">{value}</span>
    </div>
  );
}
