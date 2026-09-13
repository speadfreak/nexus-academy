// ShareExperienceDialog — the in-app flow for collecting real testimonials
// from real students. Mounted in Settings as a standing "Share your story"
// option (never forced, always skippable). Could also be triggered after
// strong results — but this component is just the modal UI itself, the
// trigger points are wired by the host component.
//
// Honesty discipline: the submission creates a `testimonials` row with
// status "pending" — it does NOT go live automatically. The student sees
// a confirmation: "Thanks for sharing — our team will review it before
// it's featured."

import { api } from "@/convex/_generated/api";
import { useMutation } from "convex/react";
import { Loader2, MessageSquareQuote, Sparkles, Star, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useFriendlyError } from "@/lib/errors";
import { cn } from "@/lib/utils";

const MAX_MESSAGE = 600;

export function ShareExperienceDialog({
  open,
  onOpenChange,
  defaultName,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  // Pre-fill the name field with the user's display name when available
  defaultName?: string;
}) {
  const friendlyError = useFriendlyError();
  const submitMut = useMutation(api.testimonials.submit);
  const generateUploadUrl = useMutation(api.testimonials.generatePhotoUploadUrl);

  const [submitterName, setSubmitterName] = useState(defaultName ?? "");
  const [roleLabel, setRoleLabel] = useState("");
  const [messageText, setMessageText] = useState("");
  const [starRating, setStarRating] = useState<number>(0);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setSubmitterName(defaultName ?? "");
    setRoleLabel("");
    setMessageText("");
    setStarRating(0);
    setPhotoFile(null);
    setPhotoPreview(null);
  };

  const onPhotoChange = (file: File | null) => {
    setPhotoFile(file);
    if (file) {
      const url = URL.createObjectURL(file);
      setPhotoPreview(url);
    } else {
      setPhotoPreview(null);
    }
  };

  const handleSubmit = async () => {
    if (!submitterName.trim() || !roleLabel.trim() || !messageText.trim()) {
      toast.error("Please fill in your name, role, and message.");
      return;
    }
    setSubmitting(true);
    try {
      let photoStorageId: string | undefined;
      if (photoFile) {
        const uploadUrl = await generateUploadUrl();
        const res = await fetch(uploadUrl, {
          method: "POST",
          body: photoFile,
        });
        if (!res.ok) throw new Error("Photo upload failed");
        const uploaded = (await res.json()) as { storageId?: string };
        photoStorageId = uploaded.storageId;
      }
      await submitMut({
        submitterName,
        roleLabel,
        messageText,
        starRating: starRating > 0 ? starRating : undefined,
        submitterPhotoStorageId: photoStorageId,
      });
      toast.success(
        "Thanks for sharing — our team will review it before it's featured on the landing page. 💜",
      );
      reset();
      onOpenChange(false);
    } catch (e) {
      toast.error(friendlyError(e, "Could not submit your testimonial."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-panel max-w-lg rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-amber-300" /> Share your experience
          </DialogTitle>
          <DialogDescription>
            Tell other students what Learnyx has done for you. Your words go to our
            team for review — if featured, they&apos;ll appear on the public landing
            page. Real words only, please.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {/* Photo + name + role */}
          <div className="flex items-start gap-3">
            {/* Photo upload */}
            <div className="flex flex-col items-center gap-1.5">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="group relative flex size-16 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-2xl border border-white/15 bg-white/[0.04] transition hover:border-amber-400/40 hover:bg-amber-400/[0.04]"
              >
                {photoPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photoPreview} alt="Your photo" className="size-full object-cover" />
                ) : (
                  <span className="flex flex-col items-center gap-0.5 text-muted-foreground">
                    <Upload className="size-4" />
                    <span className="font-mono text-[8px] uppercase tracking-wider">Photo</span>
                  </span>
                )}
                {photoPreview && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onPhotoChange(null);
                    }}
                    className="absolute right-0.5 top-0.5 flex size-5 cursor-pointer items-center justify-center rounded-full bg-black/70 text-white hover:bg-black/90"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={(e) => onPhotoChange(e.target.files?.[0] ?? null)}
                className="hidden"
              />
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold text-muted-foreground">Your name</span>
                <Input
                  value={submitterName}
                  onChange={(e) => setSubmitterName(e.target.value)}
                  placeholder="e.g. Bereket T."
                  maxLength={80}
                  className="h-10 rounded-xl bg-white/5"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold text-muted-foreground">
                  Your role (so we can label you correctly)
                </span>
                <Input
                  value={roleLabel}
                  onChange={(e) => setRoleLabel(e.target.value)}
                  placeholder="e.g. Grade 12 student, Addis Ababa"
                  maxLength={120}
                  className="h-10 rounded-xl bg-white/5"
                />
              </div>
            </div>
          </div>

          {/* Star rating */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold text-muted-foreground">
              Star rating (optional)
            </span>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStarRating(starRating === s ? 0 : s)}
                  className="cursor-pointer p-1"
                >
                  <Star
                    className={cn(
                      "size-5 transition-colors",
                      s <= starRating
                        ? "fill-amber-400 text-amber-400"
                        : "text-white/15 hover:text-white/40",
                    )}
                  />
                </button>
              ))}
              {starRating > 0 && (
                <button
                  type="button"
                  onClick={() => setStarRating(0)}
                  className="ml-1 cursor-pointer font-mono text-[10px] text-muted-foreground hover:text-foreground"
                >
                  clear
                </button>
              )}
            </div>
          </div>

          {/* Message */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold text-muted-foreground">
              Your message ({messageText.length}/{MAX_MESSAGE})
            </span>
            <Textarea
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              maxLength={MAX_MESSAGE}
              rows={4}
              placeholder="A few words about how Learnyx has helped you study — keep it punchy, other students will read this."
              className="rounded-xl bg-white/5"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" className="cursor-pointer rounded-xl bg-white/5" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="cursor-pointer rounded-xl"
            onClick={() => void handleSubmit()}
            disabled={submitting}
          >
            {submitting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <>
                <MessageSquareQuote className="size-4" /> Submit for review
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
